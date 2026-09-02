import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryBoardStore } from './testing/in-memory-board-store.js';

function deterministicIds() {
  let n = 0;
  return () => `id-${++n}`;
}

const baseTask = { tenantId: 't1', projectId: 'p1', title: 'Fix login', createdBy: 'user-1' };

test('createTask applies defaults and emits a created event', async () => {
  const store = new InMemoryBoardStore();
  const task = await store.createTask(baseTask);
  assert.equal(task.status, 'backlog');
  assert.equal(task.priority, 'medium');
  assert.equal(task.assigneeId, null);
  assert.equal(task.body, '');
  const events = await store.taskEvents(task.id);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'created');
});

test('assignTask sets the assignee, opens an assignment, and emits assigned', async () => {
  const store = new InMemoryBoardStore();
  const task = await store.createTask(baseTask);
  const updated = await store.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'user-1' });
  assert.equal(updated.assigneeKind, 'agent');
  assert.equal(updated.assigneeId, 'coding');
  const current = await store.currentAssignment(task.id);
  assert.equal(current?.assigneeId, 'coding');
  assert.equal(current?.unassignedAt, null);
  const kinds = (await store.taskEvents(task.id)).map((e) => e.kind);
  assert.deepEqual(kinds, ['created', 'assigned']);
});

test('reassignTask closes the prior assignment and emits reassigned with from/to', async () => {
  const store = new InMemoryBoardStore();
  const task = await store.createTask(baseTask);
  await store.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'user-1' });
  await store.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'reviewer', assignedBy: 'user-1' });

  const history = await store.assignmentHistory(task.id);
  assert.equal(history.length, 2);
  assert.notEqual(history[0]?.unassignedAt, null, 'first assignment is closed');
  assert.equal(history[1]?.unassignedAt, null, 'second assignment is open');

  const events = await store.taskEvents(task.id);
  const reassigned = events.find((e) => e.kind === 'reassigned');
  assert.ok(reassigned);
  assert.deepEqual(reassigned?.payload, {
    from: { kind: 'agent', id: 'coding' },
    to: { kind: 'agent', id: 'reviewer' },
  });
});

test('unassignTask clears the assignee and closes the assignment', async () => {
  const store = new InMemoryBoardStore();
  const task = await store.createTask(baseTask);
  await store.assignTask({ taskId: task.id, assigneeKind: 'user', assigneeId: 'user-2', assignedBy: 'user-1' });
  const updated = await store.unassignTask({ taskId: task.id, by: 'user-1' });
  assert.equal(updated.assigneeId, null);
  assert.equal(await store.currentAssignment(task.id), null);
  assert.ok((await store.taskEvents(task.id)).some((e) => e.kind === 'unassigned'));
});

test('updateStatus records from/to and updates the task', async () => {
  const store = new InMemoryBoardStore();
  const task = await store.createTask(baseTask);
  const updated = await store.updateStatus({ taskId: task.id, status: 'working', by: 'coding' });
  assert.equal(updated.status, 'working');
  const ev = (await store.taskEvents(task.id)).find((e) => e.kind === 'status_changed');
  assert.deepEqual(ev?.payload, { from: 'backlog', to: 'working' });
});

test('comment appends a commented event', async () => {
  const store = new InMemoryBoardStore();
  const task = await store.createTask(baseTask);
  const ev = await store.comment({ taskId: task.id, by: 'coding', text: 'on it' });
  assert.equal(ev.kind, 'commented');
  assert.equal(ev.payload.text, 'on it');
});

test('listTasks filters by project, status, and assignee', async () => {
  const store = new InMemoryBoardStore(deterministicIds());
  const a = await store.createTask({ ...baseTask, title: 'A' });
  await store.createTask({ ...baseTask, projectId: 'p2', title: 'B' });
  await store.updateStatus({ taskId: a.id, status: 'working', by: 'x' });
  await store.assignTask({ taskId: a.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'x' });

  assert.equal((await store.listTasks({ projectId: 'p1' })).length, 1);
  assert.equal((await store.listTasks({ status: 'working' })).length, 1);
  assert.equal((await store.listTasks({ assigneeId: 'coding' })).length, 1);
  assert.equal((await store.listTasks()).length, 2);
});

test('mutating a missing task throws', async () => {
  const store = new InMemoryBoardStore();
  await assert.rejects(store.updateStatus({ taskId: 'nope', status: 'done', by: 'x' }), /board task not found: nope/);
});

test('identity upsert/get/list round-trips users and agents', async () => {
  const store = new InMemoryBoardStore();
  await store.upsertUser({ id: 'u1', tenantId: 't1', projectId: 'p1', kind: 'human', displayName: 'Ada', externalRefs: {} });
  await store.upsertAgent({ id: 'coding', tenantId: 't1', projectId: 'p1', profileId: 'coding', displayName: 'Coding Agent' });
  assert.equal((await store.getUser('u1'))?.displayName, 'Ada');
  assert.equal((await store.getAgent('coding'))?.profileId, 'coding');
  assert.equal((await store.listUsers('p1')).length, 1);
  assert.equal((await store.listAgents('p1')).length, 1);
  assert.equal((await store.listAgents('p2')).length, 0);
});
