import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEngine, AgentSpec, AgentTurnResult, SessionSnapshot } from '@remote-sandbox-agents/contracts';
import { boardConversationKey, parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import {
  InMemoryBoardStore,
  InMemorySessionsRepo,
  InMemorySessionEventsRepo,
  InMemoryAgentBus,
} from '@remote-sandbox-agents/persistence';
import { BoardAssignmentRouter } from '@remote-sandbox-agents/orchestrator';
import { AgentConfigLoader } from '@remote-sandbox-agents/orchestrator';
import { BoardApiService } from '../api/board-api.js';
import { WorkerScheduler } from './worker-scheduler.js';
import { SessionContinuationService } from './session-continuation.js';
import { postWorkerSummary, postWorkerStatus } from './board-status-back.js';
import { buildBoardSessionMetadata } from './board-session-metadata.js';
import { makeResolveTargetAsync } from './resolve-target.js';
import { ProjectConfigRegistry } from './project-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerAssetsRoot = path.resolve(here, '../../../..');

class StubEngine implements AgentEngine {
  readonly kind = 'stub';
  private turn = 0;

  async runTurn(input: { spec: AgentSpec; session: SessionSnapshot }): Promise<AgentTurnResult> {
    this.turn += 1;
    const history = input.session.history.filter((e) => e.kind === 'channel.input');
    const sawPrior = history.length > 1;
    return {
      finishReason: 'completed',
      finalMessage: sawPrior ? 'Follow-up done with prior context.' : 'First run complete.',
      toolCalls: [],
    };
  }
}

async function wireBoardLoop(
  board: InMemoryBoardStore,
  sessions: InMemorySessionsRepo,
  bus: InMemoryAgentBus,
  sessionEvents: InMemorySessionEventsRepo,
) {
  const configLoader = new AgentConfigLoader({ serviceDefaultRoot: workerAssetsRoot });
  const projects = new ProjectConfigRegistry([{
    projectId: 'proj',
    tenantId: 't1',
    repos: [{ slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' }],
  }]);
  const router = new BoardAssignmentRouter({
    board,
    sessions,
    bus,
    generateId: () => crypto.randomUUID(),
    resolveTarget: makeResolveTargetAsync({ board, configLoader }),
    buildMetadata: (t, target) => buildBoardSessionMetadata(
      { projects, configLoader, defaultRepoSlug: 'sample/service' },
      t,
      target,
    ),
    onRouted: async (t, outcome) => {
      if (outcome.created && t.status === 'backlog') {
        await board.updateStatus({ taskId: t.id, status: 'triaging', by: t.assigneeId ?? 'system' });
      }
    },
  });
  const continuation = new SessionContinuationService({ sessions, sessionEvents, bus });
  const api = new BoardApiService({
    board,
    sessions,
    sessionEvents,
    tenantId: 't1',
    projectId: 'proj',
    projects: new ProjectConfigRegistry([{
      projectId: 'proj',
      tenantId: 't1',
      repos: [{ slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' }],
    }]),
    defaultRepoSlug: 'sample/service',
    routeTask: async (taskId) => {
      const outcome = await router.route(taskId);
      return { routed: outcome.routed };
    },
    followUp: (channelOrigin, text, opts) =>
      continuation.continue({
        channelOrigin,
        text,
        actor: opts?.actor ?? 'operator',
        resumeWorkspace: opts?.resumeWorkspace,
        trigger: 'api',
      }),
  });
  const engine = new StubEngine();
  const scheduler = new WorkerScheduler({
    sessions,
    bus,
    workspaceManager: {
      create: async (id: string) => ({ root: `/tmp/ws-${id}`, sessionId: id }),
      injectSessionContext: async () => {},
      cloneRepo: async () => {},
      cleanup: async () => {},
    } as never,
    resolveSpec: async () => ({
      id: 'coding-default',
      actor: 'worker',
      engine: { kind: 'pi-agent' },
      prompt: { assemble: async () => ({ system: '', cacheBreakpoints: [], hash: '' }) },
      tools: { list: () => [], invoke: async () => ({ success: true, output: '' }) },
      skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' },
      workspace: { kind: 'none', prepare: async () => ({ cleanupHints: { retention: 'delete-on-success' }, metadata: {} }), cleanup: async () => {} },
      secrets: { resolve: async () => [] } as never,
      fs: { mode: 'scoped', root: '/tmp' },
      policies: { approvalPolicy: 'never', maxTurns: 1, turnTimeoutMs: 5000, maxToolCalls: 1, maxRuntimeMinutes: 1 },
      metadata: {},
    }),
    resolveEngine: () => engine,
    resolveProfile: async () => ({
      id: 'coding-default',
      runtime: 'local',
      engine: 'pi-agent',
      modelDefaults: { model: 'stub', sandbox: 'workspace-write', approvalPolicy: 'never' },
      toolsets: [],
      skills: { mode: 'all' },
      approvalPolicy: 'never',
      limits: { maxRuntimeMinutes: 1, maxToolCalls: 1 },
      workspaceRetention: 'delete-on-success',
    }),
    onWorkerStart: async (session) => {
      const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
      if (!parsed) return;
      await postWorkerStatus(board, { taskId: parsed.taskId, status: 'working', by: session.agentSpecId });
    },
    onWorkerComplete: async (session, result) => {
      const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
      if (!parsed) return;
      await postWorkerSummary(board, {
        taskId: parsed.taskId,
        status: result.status,
        summary: result.summary ?? '',
        by: session.agentSpecId,
      });
    },
  });
  return { api, scheduler, router };
}

test('follow-up loop: first run → review → follow-up API → second run with prior channel.input', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);

  await board.upsertAgent({
    id: 'agent-coder', tenantId: 't1', projectId: 'proj',
    profileId: 'reviewer', displayName: 'Reviewer',
  });

  const task = await board.createTask({
    tenantId: 't1', projectId: 'proj', title: 'Fix README', body: 'Update the readme.', createdBy: 'user-1',
  });
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'agent-coder', assignedBy: 'user-1' });

  const { api, scheduler, router } = await wireBoardLoop(board, sessions, bus, events);
  await router.route(task.id);
  const first = await scheduler.claimAndRun();
  assert.equal(first?.status, 'succeeded');
  assert.equal((await board.getTask(task.id))?.status, 'review');

  const origin = boardConversationKey('proj', task.id);
  const sessionBefore = await sessions.findByChannelOrigin(origin);
  assert.equal(sessionBefore?.status, 'succeeded');

  const updated = await api.followUpTask(task.id, { bodyMarkdown: 'also add tests' }, 'user-1');
  assert.equal(updated?.status, 'working');

  const sessionAfter = await sessions.findById(sessionBefore!.id);
  assert.equal(sessionAfter?.status, 'routing');
  assert.equal(sessionAfter?.metadata.attemptNumber, 2);

  const history = [];
  for await (const e of bus.replay(sessionBefore!.id)) history.push(e);
  const inputs = history.filter((e) => e.kind === 'channel.input');
  assert.equal(inputs.length, 2);
  assert.equal((inputs[1]!.payload as { text: string }).text, 'also add tests');

  const second = await scheduler.claimAndRun();
  assert.equal(second?.status, 'succeeded');
  assert.match(second?.summary ?? '', /prior context/i);
  assert.equal((await board.getTask(task.id))?.status, 'review');
});
