import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgPool } from './connection.js';
import { runMigrations } from './migrate.js';
import { PgBoardStore } from './board-store.js';

const databaseUrl = process.env.DATABASE_URL;
const skip = !databaseUrl ? 'DATABASE_URL not set' : undefined;

test('PgBoardStore: create → assign → reassign → status → comment with full lineage', { skip }, async () => {
  const pool = new PgPool(databaseUrl!);
  await runMigrations(pool);
  const store = new PgBoardStore(pool);

  const stamp = `${Date.now()}-${Math.floor(performance.now())}`;
  const project = `p-${stamp}`;

  try {
    const task = await store.createTask({
      tenantId: 't1', projectId: project, title: 'Fix login', body: 'repro + fix', createdBy: 'user-1',
    });
    assert.equal(task.status, 'backlog');
    assert.equal(task.assigneeId, null);

    await store.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'coding', assignedBy: 'user-1' });
    const afterAssign = await store.getTask(task.id);
    assert.equal(afterAssign?.assigneeId, 'coding');
    assert.equal((await store.currentAssignment(task.id))?.assigneeId, 'coding');

    await store.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'reviewer', assignedBy: 'user-1' });
    const history = await store.assignmentHistory(task.id);
    assert.equal(history.length, 2);
    assert.notEqual(history[0]?.unassignedAt, null);
    assert.equal(history[1]?.unassignedAt, null);

    await store.updateStatus({ taskId: task.id, status: 'working', by: 'reviewer' });
    await store.comment({ taskId: task.id, by: 'reviewer', text: 'looking now' });

    const kinds = (await store.taskEvents(task.id)).map((e) => e.kind);
    assert.deepEqual(kinds, ['created', 'assigned', 'reassigned', 'status_changed', 'commented']);

    assert.equal((await store.listTasks({ projectId: project, status: 'working' })).length, 1);
  } finally {
    await pool.close();
  }
});

test('PgBoardStore: identity upsert/get/list', { skip }, async () => {
  const pool = new PgPool(databaseUrl!);
  await runMigrations(pool);
  const store = new PgBoardStore(pool);
  const stamp = `${Date.now()}-${Math.floor(performance.now())}`;
  const project = `p-${stamp}`;
  try {
    await store.upsertUser({ id: `u-${stamp}`, tenantId: 't1', projectId: project, kind: 'human', displayName: 'Ada', externalRefs: { slack: 'U123' } });
    await store.upsertAgent({ id: `a-${stamp}`, tenantId: 't1', projectId: project, profileId: 'coding', displayName: 'Coding Agent' });
    assert.equal((await store.getUser(`u-${stamp}`))?.displayName, 'Ada');
    assert.equal((await store.getAgent(`a-${stamp}`))?.profileId, 'coding');
    assert.equal((await store.listUsers(project)).length, 1);
    assert.equal((await store.listAgents(project)).length, 1);
  } finally {
    await pool.close();
  }
});
