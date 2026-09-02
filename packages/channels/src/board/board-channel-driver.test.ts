import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import { BoardChannelDriver } from './board-channel-driver.js';

async function seededStore() {
  const store = new InMemoryBoardStore();
  // Eligible: agent-assigned, non-terminal.
  const open = await store.createTask({ tenantId: 't1', projectId: 'proj', title: 'open', createdBy: 'u1' });
  await store.assignTask({ taskId: open.id, assigneeKind: 'agent', assigneeId: 'pi-reviewer-default', assignedBy: 'u1' });
  // Skipped: unassigned (sits in the backlog).
  const unassigned = await store.createTask({ tenantId: 't1', projectId: 'proj', title: 'unassigned', createdBy: 'u1' });
  // Skipped: assigned to a human.
  const human = await store.createTask({ tenantId: 't1', projectId: 'proj', title: 'human', createdBy: 'u1' });
  await store.assignTask({ taskId: human.id, assigneeKind: 'user', assigneeId: 'alice', assignedBy: 'u1' });
  // Skipped: agent-assigned but terminal.
  const done = await store.createTask({ tenantId: 't1', projectId: 'proj', title: 'done', createdBy: 'u1' });
  await store.assignTask({ taskId: done.id, assigneeKind: 'agent', assigneeId: 'pi-reviewer-default', assignedBy: 'u1' });
  await store.updateStatus({ taskId: done.id, status: 'done', by: 'u1' });
  // Skipped: agent completed a run and awaits human review.
  const review = await store.createTask({ tenantId: 't1', projectId: 'proj', title: 'review', createdBy: 'u1' });
  await store.assignTask({ taskId: review.id, assigneeKind: 'agent', assigneeId: 'pi-reviewer-default', assignedBy: 'u1' });
  await store.updateStatus({ taskId: review.id, status: 'review', by: 'u1' });
  return { store, open, unassigned, human, done, review };
}

test('pollOnce routes only agent-assigned, non-terminal tasks', async () => {
  const { store, open } = await seededStore();
  const routedIds: string[] = [];
  const driver = new BoardChannelDriver({
    board: store,
    route: async (taskId) => {
      routedIds.push(taskId);
      return { routed: true };
    },
  });

  const result = await driver.pollOnce();

  assert.deepEqual(routedIds, [open.id]);
  assert.deepEqual(result.routed, [open.id]);
  assert.equal(result.considered, 5);
});

test('pollOnce tallies tasks the router declined to route', async () => {
  const { store, open } = await seededStore();
  const driver = new BoardChannelDriver({
    board: store,
    route: async () => ({ routed: false }),
  });

  const result = await driver.pollOnce();

  assert.deepEqual(result.routed, []);
  assert.deepEqual(result.skipped, [open.id]);
});

test('pollOnce honors an explicit projectId filter', async () => {
  const { store, open } = await seededStore();
  const other = await store.createTask({ tenantId: 't1', projectId: 'other', title: 'other-proj', createdBy: 'u1' });
  await store.assignTask({ taskId: other.id, assigneeKind: 'agent', assigneeId: 'pi-reviewer-default', assignedBy: 'u1' });

  const routedIds: string[] = [];
  const driver = new BoardChannelDriver({
    board: store,
    projectId: 'proj',
    route: async (taskId) => {
      routedIds.push(taskId);
      return { routed: true };
    },
  });

  await driver.pollOnce();

  assert.deepEqual(routedIds, [open.id]);
});
