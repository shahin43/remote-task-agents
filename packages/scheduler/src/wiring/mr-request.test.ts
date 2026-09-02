import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import {
  captureMrRequest,
  parseMrRequestJson,
  parseMrRequestString,
} from './mr-request.js';

test('parseMrRequestJson validates title and summary', () => {
  assert.equal(parseMrRequestJson(null), null);
  assert.deepEqual(parseMrRequestJson({ title: 'Fix auth', summary: 'Added tests' }), {
    title: 'Fix auth',
    summary: 'Added tests',
    targetBranch: 'main',
    draft: true,
  });
  assert.deepEqual(
    parseMrRequestJson({
      title: 'Fix auth',
      summary: 'Added tests',
      targetBranch: 'develop',
      draft: false,
      handoffTo: 'user-dev',
    }),
    {
      title: 'Fix auth',
      summary: 'Added tests',
      targetBranch: 'develop',
      draft: false,
      handoffTo: 'user-dev',
    },
  );
});

test('parseMrRequestString tolerates malformed JSON', () => {
  assert.equal(parseMrRequestString('{not json'), null);
});

test('captureMrRequest stamps pending_approval when snapshot exists', async () => {
  const board = new InMemoryBoardStore();
  const task = await board.createTask({
    projectId: 'sample/service',
    tenantId: 'default',
    title: 'Test',
    createdBy: 'user-dev',
  });
  await board.updateStatus({ taskId: task.id, status: 'review', by: 'user-dev' });

  const result = await captureMrRequest({
    taskId: task.id,
    intent: { title: 'Fix auth', summary: 'Updated refresh handling', targetBranch: 'main', draft: true },
    fromAgentId: 'agent-coder',
    sessionId: 'sess-1',
    agentRunId: 'run-1',
    snapshotRef: { id: 'snap-1', type: 'local' },
    board,
    clock: () => '2026-06-30T12:00:00.000Z',
  });

  assert.equal(result.captured, true);
  const after = await board.getTask(task.id);
  const mr = after?.metadata?.mrRequest as Record<string, unknown>;
  assert.equal(mr.status, 'pending_approval');
  assert.equal(mr.title, 'Fix auth');
  assert.equal(mr.createdAt, '2026-06-30T12:00:00.000Z');
});

test('captureMrRequest marks blocked when snapshot is missing', async () => {
  const board = new InMemoryBoardStore();
  const task = await board.createTask({
    projectId: 'sample/service',
    tenantId: 'default',
    title: 'Test',
    createdBy: 'user-dev',
  });
  await board.updateStatus({ taskId: task.id, status: 'review', by: 'user-dev' });

  await captureMrRequest({
    taskId: task.id,
    intent: { title: 'Fix auth', summary: 'No snapshot yet', targetBranch: 'main', draft: true },
    fromAgentId: 'agent-coder',
    sessionId: 'sess-1',
    snapshotRef: null,
    board,
  });

  const after = await board.getTask(task.id);
  const mr = after?.metadata?.mrRequest as Record<string, unknown>;
  assert.equal(mr.status, 'blocked');
});
