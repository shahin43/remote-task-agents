import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import { postWorkerSummary, postWorkerStatus } from './board-status-back.js';

async function seedTask() {
  const store = new InMemoryBoardStore();
  const task = await store.createTask({ tenantId: 't1', projectId: 'p1', title: 'Do it', createdBy: 'user-1' });
  return { store, task };
}

test('postWorkerSummary moves a succeeded task to review and comments the summary', async () => {
  const { store, task } = await seedTask();
  const event = await postWorkerSummary(store, { taskId: task.id, status: 'succeeded', summary: 'Implemented X', by: 'agent-coding' });

  const updated = await store.getTask(task.id);
  assert.equal(updated?.status, 'review');
  assert.equal(event.kind, 'commented');
  const events = await store.taskEvents(task.id);
  assert.ok(events.some((e) => e.kind === 'commented' && JSON.stringify(e.payload).includes('Implemented X')));
});

test('postWorkerSummary marks a failed task as failed', async () => {
  const { store, task } = await seedTask();
  await postWorkerSummary(store, { taskId: task.id, status: 'failed', summary: 'boom', by: 'agent-coding' });
  const updated = await store.getTask(task.id);
  assert.equal(updated?.status, 'failed');
});

test('postWorkerStatus moves a task to working', async () => {
  const { store, task } = await seedTask();
  await store.updateStatus({ taskId: task.id, status: 'triaging', by: 'system' });
  await postWorkerStatus(store, { taskId: task.id, status: 'working', by: 'agent-coding' });
  const updated = await store.getTask(task.id);
  assert.equal(updated?.status, 'working');
});
