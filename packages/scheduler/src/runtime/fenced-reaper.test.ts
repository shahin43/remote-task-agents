import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryBoardStore, InMemorySessionsRepo } from '@remote-sandbox-agents/persistence';
import { reconcileDockerResources, type DockerResource, type LiveOwnership } from './fenced-reaper.js';

test('fenced reaper retains a live lease-matching resource', async () => {
  const resources: DockerResource[] = [
    { containerId: 'c-live', sessionId: 's1', runId: 'r1', leaseGeneration: 3 },
  ];
  const ownership: LiveOwnership[] = [
    { sessionId: 's1', leaseGeneration: 3, leaseExpired: false },
  ];
  const terminated: string[] = [];
  const result = await reconcileDockerResources({
    resources,
    ownership,
    terminate: async (id) => { terminated.push(id); },
  });
  assert.deepEqual(terminated, []);
  assert.deepEqual(result.retained, ['c-live']);
  assert.deepEqual(result.terminated, []);
});

test('fenced reaper terminates an expired matching resource once', async () => {
  const resources: DockerResource[] = [
    { containerId: 'c-dead', sessionId: 's1', runId: 'r1', leaseGeneration: 2 },
  ];
  const ownership: LiveOwnership[] = [
    { sessionId: 's1', leaseGeneration: 2, leaseExpired: true },
  ];
  const terminated: string[] = [];
  const result = await reconcileDockerResources({
    resources,
    ownership,
    terminate: async (id) => { terminated.push(id); },
  });
  assert.deepEqual(terminated, ['c-dead']);
  assert.deepEqual(result.terminated, ['c-dead']);
});

test('fenced reaper retains a resource whose lease generation is newer', async () => {
  const resources: DockerResource[] = [
    { containerId: 'c-old', sessionId: 's1', runId: 'r1', leaseGeneration: 1 },
  ];
  const ownership: LiveOwnership[] = [
    { sessionId: 's1', leaseGeneration: 4, leaseExpired: false },
  ];
  const terminated: string[] = [];
  await reconcileDockerResources({
    resources,
    ownership,
    terminate: async (id) => { terminated.push(id); },
  });
  assert.deepEqual(terminated, []);
});

test('two reconcilers terminate an expired resource at most once', async () => {
  const resources: DockerResource[] = [
    { containerId: 'c-dead', sessionId: 's1', runId: 'r1', leaseGeneration: 1 },
  ];
  const ownership: LiveOwnership[] = [
    { sessionId: 's1', leaseGeneration: 1, leaseExpired: true },
  ];
  const claimed = new Set<string>();
  const terminate = async (id: string) => {
    if (claimed.has(id)) return;
    claimed.add(id);
  };
  const [a, b] = await Promise.all([
    reconcileDockerResources({ resources, ownership, terminate, claimKey: 'c-dead' }),
    reconcileDockerResources({ resources, ownership, terminate, claimKey: 'c-dead' }),
  ]);
  assert.equal(claimed.size, 1);
  assert.equal(a.terminated.length + b.terminated.length, 1);
});

test('in-memory board assignment does not require a router to persist', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  await board.upsertAgent({
    id: 'agent-coder', tenantId: 't', projectId: 'p', profileId: 'coder', displayName: 'Coder',
  });
  const task = await board.createTask({
    tenantId: 't', projectId: 'p', title: 'T', body: '', createdBy: 'u1',
  });
  await board.assignTask({
    taskId: task.id, assigneeKind: 'agent', assigneeId: 'agent-coder', assignedBy: 'u1',
  });
  const stored = await board.getTask(task.id);
  assert.equal(stored?.assigneeId, 'agent-coder');
  assert.equal(await sessions.findByChannelOrigin(`board:v1:p:${task.id}`), null);
});
