import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAgentRunsRepo } from './testing/in-memory-agent-runs-repo.js';

test('AgentRunsRepo: start inserts a starting row', async () => {
  const repo = new InMemoryAgentRunsRepo();
  const row = await repo.start({
    id: 'run-1', sessionId: 'sess-1', taskId: 'task-1', attemptNumber: 1, agentSpecId: 'coding-default',
  });
  assert.equal(row.id, 'run-1');
  assert.equal(row.status, 'starting');
  assert.equal(row.sandboxSessionId, null);
  assert.equal(row.endedAt, null);
});

test('AgentRunsRepo: markSandboxReady stores guestImage when provided', async () => {
  const repo = new InMemoryAgentRunsRepo();
  await repo.start({ id: 'run-2b', sessionId: 's', attemptNumber: 1, agentSpecId: 'a' });
  await repo.markSandboxReady({
    id: 'run-2b',
    backend: 'docker',
    sandboxSessionId: 'sb-abc',
    containerId: 'ct-123',
    guestImage: {
      name: 'remote-sandbox-agents/pi-agent:local',
      digest: 'sha256:aaa',
      engine: 'pi-agent',
      kind: 'pi-agent-guest',
      bundleSha256: 'deadbeef',
      gitSha: 'abc123',
      contract: 'runner-protocol-v1',
    },
  });
  const row = await repo.findById('run-2b');
  assert.equal(row?.guestImage?.digest, 'sha256:aaa');
  assert.equal(row?.guestImage?.engine, 'pi-agent');
});

test('AgentRunsRepo: markSandboxReady leaves guestImage null when omitted', async () => {
  const repo = new InMemoryAgentRunsRepo();
  await repo.start({ id: 'run-2c', sessionId: 's', attemptNumber: 1, agentSpecId: 'a' });
  await repo.markSandboxReady({
    id: 'run-2c', backend: 'unix_local', sandboxSessionId: 'sb',
  });
  const row = await repo.findById('run-2c');
  assert.equal(row?.guestImage, null);
});

test('AgentRunsRepo: finalize sets terminal status, snapshot, summary, duration', async () => {
  const repo = new InMemoryAgentRunsRepo();
  await repo.start({ id: 'run-3', sessionId: 's', attemptNumber: 1, agentSpecId: 'a' });
  await repo.markSandboxReady({ id: 'run-3', backend: 'docker', sandboxSessionId: 'sb' });
  await repo.finalize({
    id: 'run-3',
    status: 'succeeded',
    endedAt: '2026-06-28T20:00:00.000Z',
    durationMs: 12345,
    snapshotRef: { type: 'local', id: 'snap-1', location: '/tmp/snap-1' },
    summary: 'all good',
    finishReason: 'completed',
    toolsUsed: ['shell', 'read'],
    skillsUsed: [{ id: 'repo-orientation', version: '1.0.0', contentHash: 'sha256:x', source: 'platform' }],
  });
  const row = await repo.findById('run-3');
  assert.equal(row?.status, 'succeeded');
  assert.equal(row?.endedAt, '2026-06-28T20:00:00.000Z');
  assert.equal(row?.durationMs, 12345);
  assert.equal(row?.summary, 'all good');
  assert.deepEqual(row?.toolsUsed, ['shell', 'read']);
  assert.equal(row?.skillsUsed?.[0]?.id, 'repo-orientation');
  assert.equal((row?.snapshotRef as { id: string }).id, 'snap-1');
});

test('AgentRunsRepo: finalize stores artifacts JSON', async () => {
  const repo = new InMemoryAgentRunsRepo();
  await repo.start({ id: 'run-art', sessionId: 's', taskId: 't', attemptNumber: 1, agentSpecId: 'author' });
  await repo.finalize({
    id: 'run-art',
    status: 'succeeded',
    endedAt: '2026-08-29T00:00:00.000Z',
    durationMs: 10,
    artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true }],
  });
  const row = await repo.findById('run-art');
  assert.equal(row?.artifacts?.[0]?.path, 'artifacts/paper.md');
  assert.equal(row?.artifacts?.[0]?.declared, true);
});

test('AgentRunsRepo: listLive excludes terminal rows', async () => {
  const repo = new InMemoryAgentRunsRepo();
  await repo.start({ id: 'a', sessionId: 's1', attemptNumber: 1, agentSpecId: 'x' });
  await repo.start({ id: 'b', sessionId: 's2', attemptNumber: 1, agentSpecId: 'x' });
  await repo.finalize({ id: 'a', status: 'succeeded', endedAt: '2026-01-01T00:00:00Z', durationMs: 1 });
  const live = await repo.listLive();
  assert.equal(live.length, 1);
  assert.equal(live[0]!.id, 'b');
});

test('AgentRunsRepo: listForSession orders by attemptNumber', async () => {
  const repo = new InMemoryAgentRunsRepo();
  await repo.start({ id: 'r2', sessionId: 's', attemptNumber: 2, agentSpecId: 'x' });
  await repo.start({ id: 'r1', sessionId: 's', attemptNumber: 1, agentSpecId: 'x' });
  await repo.start({ id: 'r3', sessionId: 's', attemptNumber: 3, agentSpecId: 'x' });
  const rows = await repo.listForSession('s');
  assert.deepEqual(rows.map((r) => r.attemptNumber), [1, 2, 3]);
});
