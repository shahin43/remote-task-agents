import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEngine, AgentSpec, AgentTurnResult, SessionRecord, SessionSnapshot } from '@remote-sandbox-agents/contracts';
import { parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import {
  InMemoryBoardStore,
  InMemorySessionsRepo,
  InMemorySessionEventsRepo,
  InMemoryAgentBus,
} from '@remote-sandbox-agents/persistence';
import { BoardAssignmentRouter } from '@remote-sandbox-agents/orchestrator';
import { BoardChannelDriver } from '@remote-sandbox-agents/channels';
import { AgentConfigLoader } from '@remote-sandbox-agents/orchestrator';
import { WorkerScheduler } from './worker-scheduler.js';
import { postWorkerSummary, postWorkerStatus } from './board-status-back.js';
import { buildBoardSessionMetadata } from './board-session-metadata.js';
import { makeResolveTargetAsync } from './resolve-target.js';
import { ProjectConfigRegistry } from './project-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerAssetsRoot = path.resolve(here, '../../../..');

class StubEngine implements AgentEngine {
  readonly kind = 'stub';

  async runTurn(_input: { spec: AgentSpec; session: SessionSnapshot }): Promise<AgentTurnResult> {
    return {
      finishReason: 'completed',
      finalMessage: 'Stub worker completed.',
      toolCalls: [],
      usage: undefined,
      rawMessages: [],
    };
  }
}

test('board assign loop: route → triaging → claim → working → review (stub engine)', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);

  await board.upsertAgent({
    id: 'agent-coder',
    tenantId: 't1',
    projectId: 'proj',
    profileId: 'reviewer',
    displayName: 'Reviewer',
  });

  const task = await board.createTask({
    tenantId: 't1',
    projectId: 'proj',
    title: 'Fix README',
    body: 'Update the readme.',
    createdBy: 'user-1',
  });
  await board.assignTask({
    taskId: task.id,
    assigneeKind: 'agent',
    assigneeId: 'agent-coder',
    assignedBy: 'user-1',
  });

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

  const driver = new BoardChannelDriver({ board, route: (taskId) => router.route(taskId), projectId: 'proj' });
  const poll = await driver.pollOnce();
  assert.deepEqual(poll.routed, [task.id]);

  const afterRoute = await board.getTask(task.id);
  assert.equal(afterRoute?.status, 'triaging');

  const onWorkerStart = async (session: SessionRecord): Promise<void> => {
    const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
    if (!parsed) return;
    await postWorkerStatus(board, { taskId: parsed.taskId, status: 'working', by: session.agentSpecId });
  };
  const onWorkerComplete = async (
    session: SessionRecord,
    result: { status: 'succeeded' | 'failed'; summary?: string; error?: string },
  ): Promise<void> => {
    const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
    if (!parsed) return;
    await postWorkerSummary(board, {
      taskId: parsed.taskId,
      status: result.status,
      summary: result.summary ?? '',
      by: session.agentSpecId,
    });
  };

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
    resolveEngine: () => new StubEngine(),
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
    onWorkerStart,
    onWorkerComplete,
  });

  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'succeeded');

  const afterRun = await board.getTask(task.id);
  assert.equal(afterRun?.status, 'review');

  const taskEvents = await board.taskEvents(task.id);
  assert.ok(taskEvents.some((e) => e.kind === 'status_changed' && JSON.stringify(e.payload).includes('triaging')));
  assert.ok(taskEvents.some((e) => e.kind === 'status_changed' && JSON.stringify(e.payload).includes('working')));
  assert.ok(taskEvents.some((e) => e.kind === 'commented'));
});
