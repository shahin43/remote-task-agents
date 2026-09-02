import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemorySessionsRepo,
  InMemorySessionEventsRepo,
  InMemoryAgentBus,
  InMemoryBoardStore,
} from '@remote-sandbox-agents/persistence';
import { SandboxManager, LocalSnapshotStore, DockerSandboxProvider } from '@remote-sandbox-agents/sandbox';
import type { Manifest, SandboxSession } from '@remote-sandbox-agents/sandbox';
import type { AgentEngine, AgentSpec, BoardTask, SessionRecord, WorkerProfile } from '@remote-sandbox-agents/contracts';
import { parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import { BoardAssignmentRouter } from '@remote-sandbox-agents/orchestrator';
import { BoardChannelDriver } from '@remote-sandbox-agents/channels';
import { WorkerScheduler } from './worker-scheduler.js';
import { PiRunnerEngineAdapter } from './pi-runner-engine-adapter.js';
import { piRunnerTemplate } from './agent-runtime-template.js';
import { postWorkerSummary, postWorkerStatus } from './board-status-back.js';

/**
 * Docker-gated, token-spending e2e for the FULL board loop driven by the channel
 * abstraction. Unlike `worker-scheduler.pi-docker-integration.test.ts` (which
 * hand-seeds the worker session), this proof starts from "add a task to the
 * board" and exercises the new pieces:
 *
 *   board.createTask + assignTask(agent: pi-reviewer-default)
 *     → BoardChannelDriver.pollOnce()
 *     → BoardAssignmentRouter.route()  (opens worker session + seeds channel.input)
 *     → WorkerScheduler.claimAndRun → in-container pi (Model B) via pi-runner
 *     → snapshot → onWorkerComplete → board status/summary-back
 *
 * Triple-gated (REMOTE_AGENT_LIVE_PI=true + Docker + OPENAI_API_KEY) so it never
 * runs in the default suite.
 */
const DOCKER_BIN = process.env.REMOTE_AGENT_DOCKER_BIN ?? process.env.DOCKER_BIN;
const WORKER_IMAGE = process.env.REMOTE_AGENT_WORKER_IMAGE ?? 'remote-sandbox-agents/pi-agent:local';
const LIVE = process.env.REMOTE_AGENT_LIVE_PI === 'true' && Boolean(DOCKER_BIN) && Boolean(process.env.OPENAI_API_KEY);

const PI_PROVIDER = process.env.REMOTE_AGENT_PI_PROVIDER ?? 'openai';
const PI_MODEL = process.env.REMOTE_AGENT_PI_MODEL ?? 'gpt-5.4-mini';

const BUNDLE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../agent-engines/dist/pi-runner.bundle.cjs',
);

const TASK_BODY = [
  'You are a reviewer worker running inside an isolated sandbox.',
  'Your working tree is the current directory (the repository root).',
  'Append exactly one new line `Reviewed by the pi board e2e proof.` to the file `README.md`',
  "using the write_file tool with path 'README.md' (read it first to preserve existing content).",
  'Then reply with a one-sentence review summary of what you changed. Do nothing else.',
].join(' ');

function piReviewerSpec(): AgentSpec {
  return {
    id: 'pi-reviewer-default', actor: 'worker', engine: { kind: 'pi-agent' },
    prompt: { assemble: async () => ({ system: 'You are a focused reviewer agent. Use the provided tools to make the requested change, then summarize.', cacheBreakpoints: [], hash: '' }) },
    tools: { list: () => [], invoke: async () => ({ success: true, output: '' }) },
    skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' },
    workspace: { kind: 'none', prepare: async () => ({ cleanupHints: { retention: 'delete-on-success' }, metadata: {} }), cleanup: async () => {} },
    secrets: { resolve: async () => ({}) } as never,
    fs: { mode: 'scoped', root: '/workspace' },
    policies: { approvalPolicy: 'never', maxTurns: 8, turnTimeoutMs: 300_000, maxToolCalls: 50, maxRuntimeMinutes: 10 },
    metadata: {},
  };
}

function dockerProfile(): WorkerProfile {
  return {
    id: 'pi-reviewer-default', runtime: 'sandbox-docker', engine: 'pi-agent',
    modelDefaults: { model: PI_MODEL, sandbox: 'workspace-write', approvalPolicy: 'never' },
    toolsets: [], skills: { mode: 'all' }, approvalPolicy: 'never',
    limits: { maxRuntimeMinutes: 10, maxToolCalls: 200 }, workspaceRetention: 'delete-on-success',
  };
}

/** A tiny git repo under the project tree so Docker can bind-mount it as the git mirror. */
function makeMirror(): { path: string; cleanup: () => void } {
  const root = path.resolve('runs', `board-it-mirror-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  git('config', 'user.email', 'test@remote-sandbox-agents');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(root, 'README.md'), '# sample service\n');
  git('add', '-A');
  git('commit', '-m', 'seed', '--no-gpg-sign');
  return { path: root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('board e2e: add task → channel driver routes → in-container pi reviewer → snapshot → board status-back', { skip: !LIVE ? 'set REMOTE_AGENT_LIVE_PI=true + docker + OPENAI_API_KEY to run' : false, timeout: 420_000 }, async (t) => {
  t.diagnostic(`docker=${DOCKER_BIN} image=${WORKER_IMAGE} provider=${PI_PROVIDER} model=${PI_MODEL}`);
  assert.ok(fs.existsSync(BUNDLE_PATH), `pi-runner bundle missing at ${BUNDLE_PATH} — run "npm run build:pi-runner"`);

  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);

  // 1) "Add a task" on the board and assign it to the pi reviewer agent.
  const board = new InMemoryBoardStore();
  const boardTask = await board.createTask({ tenantId: 't1', projectId: 'proj', title: 'Review the README', body: TASK_BODY, createdBy: 'user-1' });
  await board.assignTask({ taskId: boardTask.id, assigneeKind: 'agent', assigneeId: 'pi-reviewer-default', assignedBy: 'user-1' });

  // 2) The control plane: router + board channel driver. pollOnce opens the
  //    worker session and seeds the channel.input — no hand-seeding.
  const router = new BoardAssignmentRouter({
    board, sessions, bus,
    generateId: () => crypto.randomUUID(),
    resolveTarget: (task: BoardTask) => ({ kind: 'worker', agentSpecId: 'pi-reviewer-default' }),
    onRouted: async (t, outcome) => {
      if (outcome.created && t.status === 'backlog') {
        await board.updateStatus({ taskId: t.id, status: 'triaging', by: t.assigneeId ?? 'system' });
      }
    },
  });
  const driver = new BoardChannelDriver({ board, route: (taskId) => router.route(taskId) });
  const poll = await driver.pollOnce();
  t.diagnostic(`driver routed=${poll.routed.join(',')} considered=${poll.considered}`);
  assert.deepEqual(poll.routed, [boardTask.id], 'driver routed the assigned task');

  const mirror = makeMirror();
  const snapRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-it-snap-'));
  const manifest: Manifest = {
    version: 1, root: '/workspace', env: {},
    entries: {
      'AGENTS.md': { type: 'inline_file', dest: 'AGENTS.md', content: '# Worker\nWork in the repo working tree.\n' },
      repo: { type: 'git_mount', provider: 'local', repo: mirror.path, baseRef: 'main', dest: 'repo', workingBranch: 'pi/board-e2e' },
    },
  };

  const manager = new SandboxManager({
    providers: [new DockerSandboxProvider({ dockerBin: DOCKER_BIN!, image: WORKER_IMAGE, network: true, envAllowlist: [] })],
    snapshotStore: new LocalSnapshotStore({ root: snapRoot }),
    clock: () => new Date().toISOString(),
  });

  const resolveEngine = (_spec: AgentSpec, sandboxSession?: SandboxSession): AgentEngine =>
    new PiRunnerEngineAdapter({
      sandboxSession: sandboxSession!,
      template: piRunnerTemplate,
      bundlePath: BUNDLE_PATH,
      provider: PI_PROVIDER,
      model: PI_MODEL,
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY! },
    });

  const onWorkerStart = async (session: SessionRecord): Promise<void> => {
    const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
    if (!parsed) return;
    await postWorkerStatus(board, { taskId: parsed.taskId, status: 'working', by: session.agentSpecId });
  };

  const onWorkerComplete = async (session: SessionRecord, result: { status: 'succeeded' | 'failed'; summary?: string; error?: string }): Promise<void> => {
    const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
    if (!parsed) return;
    await postWorkerSummary(board, { taskId: parsed.taskId, status: result.status, summary: result.summary ?? result.error ?? '', by: session.agentSpecId });
  };

  const scheduler = new WorkerScheduler({
    sessions, bus,
    workspaceManager: { create: async () => { throw new Error('legacy path must NOT run'); } } as never,
    resolveSpec: async () => piReviewerSpec(),
    resolveEngine,
    sandboxManager: manager,
    resolveProfile: async () => dockerProfile(),
    resolveProviderOptionsFor: () => ({ type: 'docker' }),
    buildManifestFor: () => manifest,
    onWorkerStart,
    onWorkerComplete,
  });

  try {
    const result = await scheduler.claimAndRun();
    t.diagnostic(`worker status=${result?.status} summary=${(result?.summary ?? '').slice(0, 160)}`);
    assert.equal(result?.status, 'succeeded', 'in-container pi reviewer turn completed');

    const updatedTask = await board.getTask(boardTask.id);
    assert.equal(updatedTask?.status, 'review', 'board task moved to review on success');
    const taskEvents = await board.taskEvents(boardTask.id);
    assert.ok(taskEvents.some((e) => e.kind === 'status_changed' && JSON.stringify(e.payload).includes('triaging')));
    assert.ok(taskEvents.some((e) => e.kind === 'status_changed' && JSON.stringify(e.payload).includes('working')));
    assert.ok(taskEvents.some((e) => e.kind === 'commented'), 'a summary comment was posted to the board');

    // The worker session the driver opened recorded the in-container tool calls.
    const workerSession = await sessions.findByChannelOrigin(`board:v1:proj:${boardTask.id}`);
    assert.ok(workerSession, 'driver opened a worker session bound to the board task');
    const workerEvents = await events.list(workerSession!.id);
    const toolCalls = workerEvents.filter((e) => e.eventType === 'action' && e.kind.startsWith('tool_call.'));
    assert.ok(toolCalls.length > 0, 'pi-runner executed at least one tool in the container');
  } finally {
    mirror.cleanup();
    await fsp.rm(snapRoot, { recursive: true, force: true }).catch(() => {});
  }
});
