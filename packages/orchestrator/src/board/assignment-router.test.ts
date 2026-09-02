import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BoardTask } from '@remote-sandbox-agents/contracts';
import { InMemoryBoardStore, InMemorySessionsRepo, InMemorySessionEventsRepo, InMemoryAgentBus } from '@remote-sandbox-agents/persistence';
import { BoardAssignmentRouter, type AssigneeTarget } from './assignment-router.js';

function makeRouter(resolveTarget: (t: BoardTask) => AssigneeTarget) {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  let n = 0;
  const router = new BoardAssignmentRouter({
    board, sessions, bus, generateId: () => `sess-${++n}`, resolveTarget,
  });
  return { board, sessions, bus, router };
}

const base = { tenantId: 't1', projectId: 'p1', title: 'Fix login', body: 'repro+fix', createdBy: 'u1' };

test('routes a worker-profile assignment to a top-level routing worker session', async () => {
  const { board, sessions, bus, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'coding' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'u1' });

  const out = await router.route(task.id);
  assert.deepEqual(out, { routed: true, kind: 'worker', sessionId: 'sess-1', created: true });

  const session = await sessions.findById('sess-1');
  assert.equal(session?.actor, 'worker');
  assert.equal(session?.status, 'routing');
  assert.equal(session?.parentSessionId, null);
  assert.equal(session?.channelOrigin, 'board:v1:p1:' + task.id);
  assert.equal(session?.metadata.goal, 'Fix login');
  assert.equal(session?.metadata.boardTaskId, task.id);

  // The engine "current input" was seeded.
  const events = [];
  for await (const e of bus.replay('sess-1')) events.push(e);
  const input = events.find((e) => e.eventType === 'input' && e.kind === 'channel.input');
  assert.ok(input);
  assert.match((input!.payload as { text: string }).text, /Fix login/);
});

test('routes an orchestrator assignment to an open orchestrator session with a seeded input', async () => {
  const { board, sessions, router } = makeRouter(() => ({ kind: 'orchestrator', agentSpecId: 'orchestrator' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'orchestrator', assignedBy: 'u1' });

  const out = await router.route(task.id);
  assert.equal(out.routed, true);
  assert.equal((out as { kind: string }).kind, 'orchestrator');
  const session = await sessions.findById('sess-1');
  assert.equal(session?.actor, 'orchestrator');
  assert.equal(session?.status, 'open');
});

test('dedups: re-routing a live task reuses the existing session', async () => {
  const { board, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'coding' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'u1' });

  const first = await router.route(task.id);
  const second = await router.route(task.id);
  assert.equal((first as { sessionId: string }).sessionId, (second as { sessionId: string }).sessionId);
  assert.equal((second as { created: boolean }).created, false);
});

test('re-routing after the worker session is terminal opens a fresh session', async () => {
  const { board, sessions, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'coding' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'u1' });

  const first = await router.route(task.id);
  await sessions.updateStatus((first as { sessionId: string }).sessionId, 'succeeded');
  const second = await router.route(task.id);
  assert.notEqual((first as { sessionId: string }).sessionId, (second as { sessionId: string }).sessionId);
  assert.equal((second as { created: boolean }).created, true);
});

test('does not route unassigned or human-assigned tasks', async () => {
  const { board, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'coding' }));
  const unassigned = await board.createTask(base);
  assert.deepEqual(await router.route(unassigned.id), { routed: false, reason: 'unassigned' });

  const human = await board.createTask(base);
  await board.assignTask({ taskId: human.id, assigneeKind: 'user', assigneeId: 'u2', assignedBy: 'u1' });
  assert.deepEqual(await router.route(human.id), { routed: false, reason: 'human' });
});

// ----- handoffContext propagation -----

test('handoffContext: opens the next session with resumeSnapshotRef + handoffFrom on metadata', async () => {
  const { board, sessions, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'reviewer' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'agent-reviewer', assignedBy: 'agent-coder' });
  await board.mergeTaskMetadata({
    taskId: task.id,
    patch: {
      handoffContext: {
        fromAgentId: 'agent-coder',
        toAgentId: 'agent-reviewer',
        snapshotRef: { id: 'snap-xyz-1', mediaType: 'application/x-tar' },
        summary: 'Added auth guard; ran tests (passed).',
        message: 'focus on src/api/auth.ts',
        appliedAt: '2026-06-29T22:30:00Z',
      },
    },
  });

  await router.route(task.id);
  const session = await sessions.findById('sess-1');
  assert.deepEqual(session?.metadata.resumeSnapshotRef, { id: 'snap-xyz-1', mediaType: 'application/x-tar' });
  const handoffFrom = session?.metadata.handoffFrom as Record<string, unknown> | undefined;
  assert.ok(handoffFrom);
  assert.equal(handoffFrom.agentId, 'agent-coder');
  assert.match(handoffFrom.summary as string, /Added auth guard/);
  assert.match(handoffFrom.message as string, /src\/api\/auth\.ts/);
});

test('handoffContext: seeded channel.input includes the source agent summary and handoff note', async () => {
  const { board, bus, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'reviewer' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'agent-reviewer', assignedBy: 'agent-coder' });
  await board.mergeTaskMetadata({
    taskId: task.id,
    patch: {
      handoffContext: {
        fromAgentId: 'agent-coder',
        toAgentId: 'agent-reviewer',
        snapshotRef: null,
        summary: 'wrote three new tests; npm test passed',
        message: 'review the test design',
        appliedAt: '2026-06-29T22:30:00Z',
      },
    },
  });

  await router.route(task.id);
  const events: unknown[] = [];
  for await (const e of bus.replay('sess-1')) events.push(e);
  const input = events.find((e: any) => e.eventType === 'input' && e.kind === 'channel.input') as any;
  const text: string = input?.payload?.text ?? '';
  assert.match(text, /Fix login/, 'preserves the original brief');
  assert.match(text, /Handoff from agent-coder/, 'preamble names the source agent');
  assert.match(text, /wrote three new tests/, 'preamble carries the source summary');
  assert.match(text, /review the test design/, 'preamble carries the handoff message');
});

test('handoffContext absent: prompt is unchanged (no regression in the no-handoff path)', async () => {
  const { board, bus, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'coding' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'u1' });
  await router.route(task.id);
  const events: unknown[] = [];
  for await (const e of bus.replay('sess-1')) events.push(e);
  const input = events.find((e: any) => e.eventType === 'input' && e.kind === 'channel.input') as any;
  const text: string = input?.payload?.text ?? '';
  assert.match(text, /Fix login/, 'preserves the original brief');
  assert.match(text, /repro\+fix/, 'preserves the original body');
  assert.match(text, /SOUL\.md/, 'routing disclaimer: profile owns handoff targets');
  assert.equal(text.includes('Handoff from'), false, 'no handoff preamble when context is absent');
});

test('seeded channel.input tells the agent the task body is not handoff routing', async () => {
  const { board, bus, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'reviewer' }));
  const task = await board.createTask({
    ...base,
    body: 'When done you MUST call handoff to agent-reviewer.',
  });
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'u1' });
  await router.route(task.id);
  const events: unknown[] = [];
  for await (const e of bus.replay('sess-1')) events.push(e);
  const input = events.find((e: any) => e.eventType === 'input' && e.kind === 'channel.input') as any;
  const text: string = input?.payload?.text ?? '';
  assert.match(text, /MUST call handoff to agent-reviewer/, 'keeps the operator brief verbatim');
  assert.match(text, /not binding|not routing|SOUL\.md/i, 'tells the model profile routing wins');
});

test('concurrent create unique-violation reuses the live session', async () => {
  const board = new InMemoryBoardStore();
  const inner = new InMemorySessionsRepo();
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  let finds = 0;
  const sessions = {
    create: async (input: Parameters<InMemorySessionsRepo['create']>[0]) => {
      if ((await inner.findByChannelOrigin(input.channelOrigin ?? '')) && input.id !== 'sess-1') {
        const { UniqueLiveSessionError } = await import('@remote-sandbox-agents/persistence');
        throw new UniqueLiveSessionError(input.channelOrigin);
      }
      return inner.create(input);
    },
    findByChannelOrigin: async (origin: string) => {
      finds += 1;
      // First two lookups (two concurrent route() calls) miss the live row.
      if (finds <= 2) return null;
      return inner.findByChannelOrigin(origin);
    },
    findById: (id: string) => inner.findById(id),
  } as unknown as InMemorySessionsRepo;
  let n = 0;
  const router = new BoardAssignmentRouter({
    board,
    sessions,
    bus,
    generateId: () => `sess-${++n}`,
    resolveTarget: () => ({ kind: 'worker', agentSpecId: 'coding' }),
  });
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'u1' });
  const first = await router.route(task.id);
  const second = await router.route(task.id);
  assert.equal((first as { created: boolean }).created, true);
  assert.equal((second as { created: boolean }).created, false);
  assert.equal((second as { sessionId: string }).sessionId, (first as { sessionId: string }).sessionId);
});

test('handoffContext with no snapshotRef: resumeSnapshotRef must NOT be set (skips hydrate)', async () => {
  const { board, sessions, router } = makeRouter(() => ({ kind: 'worker', agentSpecId: 'reviewer' }));
  const task = await board.createTask(base);
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'agent-reviewer', assignedBy: 'agent-coder' });
  await board.mergeTaskMetadata({
    taskId: task.id,
    patch: {
      handoffContext: {
        fromAgentId: 'agent-coder',
        toAgentId: 'agent-reviewer',
        snapshotRef: null,
        summary: 'nothing to snapshot',
        appliedAt: '2026-06-29T22:30:00Z',
      },
    },
  });
  await router.route(task.id);
  const session = await sessions.findById('sess-1');
  assert.equal(session?.metadata.resumeSnapshotRef, undefined);
});
