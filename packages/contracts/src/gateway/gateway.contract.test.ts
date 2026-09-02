import assert from 'node:assert/strict';
import test from 'node:test';
import type { RemoteAgentTask, SubmitReceipt } from '../index.js';

test('RemoteAgentTask survives JSON round-trip', () => {
  const task: RemoteAgentTask = {
    taskId: 'task-001',
    source: 'linear',
    intent: 'implement',
    repo: {
      provider: 'local',
      projectId: 'sample/service',
      baseBranch: 'main',
      targetPaths: ['src/'],
    },
    workItem: {
      type: 'linear',
      key: 'ENG-123',
      title: 'Add user endpoint',
      description: 'Implement GET /users/:id',
      url: 'https://linear.app/org/issue/ENG-123',
    },
    workflow: {
      path: 'WORKFLOW.md',
      handoffState: 'ready',
    },
    constraints: {
      maxRuntimeMinutes: 15,
      networkProfile: 'off',
      writeMode: 'draft-mr',
      requiresHumanApproval: false,
    },
    idempotency: {
      runKey: 'ENG-123-attempt-1',
      branchName: 'agent/ENG-123',
    },
    prompt: 'Implement the user endpoint as described.',
  };

  const serialized = JSON.stringify(task);
  const deserialized: RemoteAgentTask = JSON.parse(serialized);

  assert.deepEqual(deserialized, task);
  assert.equal(typeof deserialized.taskId, 'string');
  assert.equal(typeof deserialized.constraints.maxRuntimeMinutes, 'number');
});

test('SubmitReceipt survives JSON round-trip', () => {
  const receipt: SubmitReceipt = {
    taskKey: 'task-001',
    status: 'accepted',
    runKey: 'ENG-123-attempt-1',
  };

  const serialized = JSON.stringify(receipt);
  const deserialized: SubmitReceipt = JSON.parse(serialized);

  assert.deepEqual(deserialized, receipt);
});

test('SubmitReceipt status is accepted or duplicate', () => {
  const accepted: SubmitReceipt = { taskKey: 'k', status: 'accepted', runKey: 'r' };
  const duplicate: SubmitReceipt = { taskKey: 'k', status: 'duplicate', runKey: 'r' };
  assert.equal(accepted.status, 'accepted');
  assert.equal(duplicate.status, 'duplicate');
});
