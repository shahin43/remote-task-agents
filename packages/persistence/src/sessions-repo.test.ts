import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySessionsRepo } from './testing/in-memory-sessions-repo.js';

test('createSession assigns id and persists row', async () => {
  const repo = new InMemorySessionsRepo();
  const created = await repo.create({
    id: 'sess-1', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: 'linear:AGE-7', agentSpecId: 'orchestrator-supervisor', metadata: {},
  });
  assert.equal(created.id, 'sess-1');
  assert.equal(created.status, 'open');
  assert.ok(created.openedAt);
  assert.ok(created.lastActivityAt);
});

test('findByChannelOrigin returns existing session', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'sess-1', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: 'linear:AGE-7', agentSpecId: 'orchestrator-supervisor', metadata: {},
  });
  const found = await repo.findByChannelOrigin('linear:AGE-7');
  assert.equal(found?.id, 'sess-1');
});

test('updateStatus changes status and last_activity_at', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'sess-1', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: 'linear:AGE-7', agentSpecId: 'orchestrator-supervisor', metadata: {},
  });
  await repo.updateStatus('sess-1', 'closed');
  const session = await repo.findById('sess-1');
  assert.equal(session?.status, 'closed');
  assert.ok(session?.closedAt);
});

test('updateStatus to routing clears closedAt and lease on reopen', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'sess-2', actor: 'worker', parentSessionId: null, status: 'succeeded',
    channelOrigin: 'board:v1:p:t', agentSpecId: 'pi-reviewer-default', metadata: {},
  });
  await repo.updateStatus('sess-2', 'succeeded');
  assert.ok((await repo.findById('sess-2'))!.closedAt);

  await repo.updateStatus('sess-2', 'routing');
  const session = await repo.findById('sess-2');
  assert.equal(session?.status, 'routing');
  assert.equal(session?.closedAt, null);
  assert.equal(session?.leaseExpiresAt, null);
});

test('claimNextRouting claims the oldest routing session and sets the lease', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'w-newer', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: null, agentSpecId: 'coding-default', metadata: {},
  });
  // Force ordering: make w-older strictly older.
  const older = await repo.create({
    id: 'w-older', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: null, agentSpecId: 'coding-default', metadata: {},
  });
  (older as { openedAt: string }).openedAt = '2000-01-01T00:00:00.000Z';

  const lease = new Date(Date.now() + 60_000).toISOString();
  const first = await repo.claimNextRouting('worker', lease);
  assert.equal(first?.id, 'w-older');
  assert.equal(first?.status, 'running');
  assert.equal(first?.leaseExpiresAt, lease);

  const second = await repo.claimNextRouting('worker', lease);
  assert.equal(second?.id, 'w-newer');

  // Nothing left to claim.
  assert.equal(await repo.claimNextRouting('worker', lease), null);
});

test('listExpiredRunning returns only running sessions with an expired lease', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'w-1', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: null, agentSpecId: 'coding-default', metadata: {},
  });
  await repo.create({
    id: 'w-2', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: null, agentSpecId: 'coding-default', metadata: {},
  });
  await repo.claimNextRouting('worker', new Date(Date.now() - 1000).toISOString()); // expired
  await repo.claimNextRouting('worker', new Date(Date.now() + 60_000).toISOString()); // live

  const expired = await repo.listExpiredRunning('worker', new Date().toISOString());
  assert.equal(expired.length, 1);
  assert.equal(expired[0].leaseExpiresAt! < new Date().toISOString(), true);
});

test('create refuses a second live session for the same channel origin', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'live-1', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: 'board:v1:p:t', agentSpecId: 'coder', metadata: {},
  });
  await assert.rejects(
    () => repo.create({
      id: 'live-2', actor: 'worker', parentSessionId: null, status: 'routing',
      channelOrigin: 'board:v1:p:t', agentSpecId: 'coder', metadata: {},
    }),
    /live session already exists/,
  );
});

test('create allows a new session after the previous channel origin is terminal', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'old', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: 'board:v1:p:t', agentSpecId: 'coder', metadata: {},
  });
  await repo.updateStatus('old', 'succeeded');
  const next = await repo.create({
    id: 'new', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: 'board:v1:p:t', agentSpecId: 'reviewer', metadata: {},
  });
  assert.equal(next.id, 'new');
});

test('claimNextRouting records lease owner and increments generation', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'w-1', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: null, agentSpecId: 'coder', metadata: {},
  });
  const lease = new Date(Date.now() + 60_000).toISOString();
  const claimed = await repo.claimNextRouting('worker', lease, { workerId: 'worker-7' });
  assert.equal(claimed?.leaseOwner, 'worker-7');
  assert.equal(claimed?.leaseGeneration, 1);
});

test('listPendingCompletion returns terminal sessions awaiting control projection', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'done', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: 'board:v1:p:t', agentSpecId: 'coder', metadata: {},
  });
  await repo.updateStatus('done', 'succeeded');
  await repo.mergeMetadata('done', { completionPending: { status: 'succeeded' } });
  const pending = await repo.listPendingCompletion();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.id, 'done');
});

test('mergeMetadata shallow-merges keys without dropping existing ones', async () => {
  const repo = new InMemorySessionsRepo();
  await repo.create({
    id: 'sess-1', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: null, agentSpecId: 'orchestrator-supervisor', metadata: { goal: 'triage' },
  });
  await repo.mergeMetadata('sess-1', { lastProcessedInputIndex: 4 });
  const session = await repo.findById('sess-1');
  assert.equal(session?.metadata.goal, 'triage');
  assert.equal(session?.metadata.lastProcessedInputIndex, 4);
});
