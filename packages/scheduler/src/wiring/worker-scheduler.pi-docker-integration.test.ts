import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemorySessionsRepo, InMemorySessionEventsRepo, InMemoryAgentBus, InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import { SandboxManager, LocalSnapshotStore, DockerSandboxProvider } from '@remote-sandbox-agents/sandbox';
import type { Manifest, SandboxSession } from '@remote-sandbox-agents/sandbox';
import type { AgentEngine, AgentSpec, SessionRecord, WorkerProfile } from '@remote-sandbox-agents/contracts';
import { boardConversationKey, parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import { WorkerScheduler } from './worker-scheduler.js';
import { PiRunnerEngineAdapter } from './pi-runner-engine-adapter.js';
import { piRunnerTemplate } from './agent-runtime-template.js';
import { postWorkerSummary } from './board-status-back.js';

/**
 * Docker-gated, token-spending e2e proof for the IN-CONTAINER pi worker (Model B).
 *
 * Drives the full board path that matters: a board worker session
 * (channel_origin board:v1:<project>:<task>) → PiRunnerEngineAdapter → real pi
 * loop running INSIDE the docker container via the pi-runner bundle → repo edit →
 * harness commit → snapshot → board status/summary-back. pi authenticates inside
 * the container from OPENAI_API_KEY forwarded on the exec env.
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

const TASK_INSTRUCTION = [
  'You are a coding worker running inside an isolated sandbox.',
  'Your working tree is the current directory (the repository root).',
  'Append exactly one new line `Edited by the pi docker e2e proof.` to the file `README.md`',
  "using the write_file tool with path 'README.md' (read it first to preserve existing content).",
  'Then reply with a one-sentence summary of what you changed. Do nothing else.',
].join(' ');

function piWorkerSpec(): AgentSpec {
  return {
    id: 'pi-coding-default', actor: 'worker', engine: { kind: 'pi-agent' },
    prompt: { assemble: async () => ({ system: 'You are a focused coding agent. Use the provided tools to make the requested change, then summarize.', cacheBreakpoints: [], hash: '' }) },
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
    id: 'pi-coding-default', runtime: 'sandbox-docker', engine: 'pi-agent',
    modelDefaults: { model: PI_MODEL, sandbox: 'workspace-write', approvalPolicy: 'never' },
    toolsets: [], skills: { mode: 'all' }, approvalPolicy: 'never',
    limits: { maxRuntimeMinutes: 10, maxToolCalls: 200 }, workspaceRetention: 'delete-on-success',
  };
}

/** A tiny git repo under the project tree so Docker can bind-mount it as the git mirror. */
function makeMirror(): { path: string; cleanup: () => void } {
  const root = path.resolve('runs', `pi-it-mirror-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

test('pi docker e2e: board session → in-container pi-runner → snapshot → board status-back', { skip: !LIVE ? 'set REMOTE_AGENT_LIVE_PI=true + docker + OPENAI_API_KEY to run' : false, timeout: 420_000 }, async (t) => {
  t.diagnostic(`docker=${DOCKER_BIN} image=${WORKER_IMAGE} provider=${PI_PROVIDER} model=${PI_MODEL}`);
  assert.ok(fs.existsSync(BUNDLE_PATH), `pi-runner bundle missing at ${BUNDLE_PATH} — run "npm run build:pi-runner"`);

  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);

  // Board store + a seeded task. The worker session's channel_origin links to it.
  const board = new InMemoryBoardStore();
  const boardTask = await board.createTask({ tenantId: 't1', projectId: 'proj', title: 'Edit the README', createdBy: 'user-1' });
  const channelOrigin = boardConversationKey('proj', boardTask.id);

  await sessions.create({ id: 'pi-worker', actor: 'worker', parentSessionId: null, status: 'routing', channelOrigin, agentSpecId: 'pi-coding-default', metadata: { goal: 'Edit the README' } });
  // Seed the channel.input the worker reads as its task (becomes pi-runner spec.input).
  await bus.publish({ sessionId: 'pi-worker', eventType: 'input', kind: 'channel.input', payload: { text: TASK_INSTRUCTION } });

  const mirror = makeMirror();
  const snapRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pi-it-snap-'));
  const manifest: Manifest = {
    version: 1, root: '/workspace', env: {},
    entries: {
      'AGENTS.md': { type: 'inline_file', dest: 'AGENTS.md', content: '# Worker\nWork in the repo working tree.\n' },
      repo: { type: 'git_mount', provider: 'local', repo: mirror.path, baseRef: 'main', dest: 'repo', workingBranch: 'pi/e2e' },
    },
  };

  const manager = new SandboxManager({
    providers: [new DockerSandboxProvider({ dockerBin: DOCKER_BIN!, image: WORKER_IMAGE, network: true, envAllowlist: [] })],
    snapshotStore: new LocalSnapshotStore({ root: snapRoot }),
    clock: () => new Date().toISOString(),
  });

  // Mirrors the composition root: pi + a live docker session → in-container adapter.
  const resolveEngine = (_spec: AgentSpec, sandboxSession?: SandboxSession): AgentEngine =>
    new PiRunnerEngineAdapter({
      sandboxSession: sandboxSession!,
      template: piRunnerTemplate,
      bundlePath: BUNDLE_PATH,
      provider: PI_PROVIDER,
      model: PI_MODEL,
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY! },
    });

  const onWorkerComplete = async (session: SessionRecord, result: { status: 'succeeded' | 'failed'; summary?: string; error?: string }): Promise<void> => {
    const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
    if (!parsed) return;
    await postWorkerSummary(board, { taskId: parsed.taskId, status: result.status, summary: result.summary ?? result.error ?? '', by: session.agentSpecId });
  };

  const scheduler = new WorkerScheduler({
    sessions, bus,
    workspaceManager: { create: async () => { throw new Error('legacy path must NOT run'); } } as never,
    resolveSpec: async () => piWorkerSpec(),
    resolveEngine,
    sandboxManager: manager,
    resolveProfile: async () => dockerProfile(),
    resolveProviderOptionsFor: () => ({ type: 'docker' }),
    buildManifestFor: () => manifest,
    onWorkerComplete,
  });

  try {
    const result = await scheduler.claimAndRun();
    t.diagnostic(`worker status=${result?.status} summary=${(result?.summary ?? '').slice(0, 160)}`);
    assert.equal(result?.status, 'succeeded', 'in-container pi turn completed');

    // The worker session recorded the in-container tool calls.
    const workerEvents = await events.list('pi-worker');
    const toolCalls = workerEvents.filter((e) => e.eventType === 'action' && e.kind.startsWith('tool_call.'));
    t.diagnostic(`in-container tool calls: ${toolCalls.map((e) => e.kind).join(', ')}`);
    assert.ok(toolCalls.length > 0, 'pi-runner executed at least one tool in the container');

    // Snapshot present + non-empty diff from the agent's edit.
    const done = workerEvents.find((e) => e.kind === 'worker_end');
    const ref = (done!.payload as { snapshotRef?: { location: string } }).snapshotRef;
    assert.ok(ref?.location, 'snapshot ref present');
    const patch = await fsp.readFile(path.join(ref!.location, 'git', 'changes.patch'), 'utf8').catch(() => '');
    t.diagnostic(`changes.patch bytes=${patch.length}`);
    assert.ok(patch.includes('Edited by the pi docker e2e proof'), 'snapshot captured the README edit');

    // Board status/summary-back landed.
    const updatedTask = await board.getTask(boardTask.id);
    assert.equal(updatedTask?.status, 'review', 'board task moved to review on success');
    const taskEvents = await board.taskEvents(boardTask.id);
    assert.ok(taskEvents.some((e) => e.kind === 'commented'), 'a summary comment was posted to the board');
  } finally {
    mirror.cleanup();
    await fsp.rm(snapRoot, { recursive: true, force: true }).catch(() => {});
  }
});
