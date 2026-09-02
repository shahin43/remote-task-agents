import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  InMemoryAgentBus,
  InMemoryBoardStore,
  InMemorySessionEventsRepo,
  InMemorySessionsRepo,
} from '@remote-sandbox-agents/persistence';
import { BoardAssignmentRouter } from '@remote-sandbox-agents/orchestrator';
import { recordWorkerCompletion, projectPendingCompletions } from './completion-projector.js';

test('control projector is idempotent for a recorded worker completion', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  await board.upsertAgent({
    id: 'agent-coder', tenantId: 't1', projectId: 'p1', profileId: 'coder', displayName: 'Coder',
  });
  await board.upsertUser({
    id: 'user-dev', tenantId: 't1', projectId: 'p1', kind: 'human', displayName: 'Dev operator', externalRefs: {},
  });
  const task = await board.createTask({
    tenantId: 't1', projectId: 'p1', title: 'Work', body: 'do it', createdBy: 'user-dev',
  });
  await board.assignTask({
    taskId: task.id, assigneeKind: 'agent', assigneeId: 'agent-coder', assignedBy: 'user-dev',
  });
  const session = await sessions.create({
    id: 'sess-1',
    actor: 'worker',
    parentSessionId: null,
    status: 'succeeded',
    channelOrigin: `board:v1:p1:${task.id}`,
    agentSpecId: 'coder',
    metadata: { boardTaskId: task.id },
  });
  await recordWorkerCompletion(sessions, session, {
    status: 'succeeded',
    summary: 'done',
  });
  const router = new BoardAssignmentRouter({
    board,
    sessions,
    bus,
    generateId: () => crypto.randomUUID(),
    resolveTarget: () => ({ kind: 'human' }),
  });
  const first = await projectPendingCompletions({
    board, sessions, router, autobounceHuman: 'user-dev',
  });
  const second = await projectPendingCompletions({
    board, sessions, router, autobounceHuman: 'user-dev',
  });
  assert.equal(first, 1);
  assert.equal(second, 0);
});

test('control projector logs request_mr onto the board without opening host git', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  await board.upsertAgent({
    id: 'agent-coder', tenantId: 't1', projectId: 'p1', profileId: 'coder', displayName: 'Coder',
  });
  await board.upsertUser({
    id: 'user-dev', tenantId: 't1', projectId: 'p1', kind: 'human', displayName: 'Dev operator', externalRefs: {},
  });
  const task = await board.createTask({
    tenantId: 't1', projectId: 'p1', title: 'Work', body: 'do it', createdBy: 'user-dev',
  });
  const session = await sessions.create({
    id: 'sess-mr',
    actor: 'worker',
    parentSessionId: null,
    status: 'succeeded',
    channelOrigin: `board:v1:p1:${task.id}`,
    agentSpecId: 'coder',
    metadata: { boardTaskId: task.id },
  });
  await recordWorkerCompletion(sessions, session, {
    status: 'succeeded',
    summary: 'added marker file',
    mrRequest: { title: 'Add marker', summary: 'one-line e2e file', targetBranch: 'main', draft: true },
    snapshotRef: { type: 'local', id: 'snap-1', location: '/tmp/snapshots/snap-1' },
  });
  const router = new BoardAssignmentRouter({
    board,
    sessions,
    bus,
    generateId: () => crypto.randomUUID(),
    resolveTarget: () => ({ kind: 'human' }),
  });
  await projectPendingCompletions({ board, sessions, router, autobounceHuman: 'user-dev' });
  const after = await board.getTask(task.id);
  const mr = after?.metadata?.mrRequest as Record<string, unknown>;
  assert.equal(mr.status, 'pending_approval');
  assert.equal(mr.title, 'Add marker');
  assert.equal(mr.sessionId, 'sess-mr');
  assert.deepEqual(mr.snapshotRef, { type: 'local', id: 'snap-1', location: '/tmp/snapshots/snap-1' });
  assert.equal(mr.mrUrl, undefined);
});
