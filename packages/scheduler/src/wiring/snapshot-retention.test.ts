import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planSnapshotSweep,
  runSnapshotSweep,
  startSnapshotRetentionSweep,
  DEFAULT_SWEEP_POLICY,
  type AgentRunSnapshotRef,
  type SnapshotMeta,
  type SnapshotStoreOps,
  type AgentRunsRefSource,
  type SnapshotSweepLogger,
} from './snapshot-retention.js';

const NOW = Date.parse('2026-06-29T20:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function snap(id: string, daysOld: number, bytes = 1_000): SnapshotMeta {
  return {
    id,
    createdAt: new Date(NOW - daysOld * DAY).toISOString(),
    bytes,
  };
}

function ref(snapshotId: string, taskId: string | null, daysOld: number, inFlight = false): AgentRunSnapshotRef {
  return {
    snapshotId,
    taskId,
    inFlight,
    startedAt: new Date(NOW - daysOld * DAY).toISOString(),
  };
}

test('planSnapshotSweep: deletes snapshots older than maxAgeMs', () => {
  const plan = planSnapshotSweep(
    [snap('a', 1), snap('b', 40), snap('c', 100)],
    [],
    { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0 },
    NOW,
  );
  assert.deepEqual(plan.delete.map((s) => s.id).sort(), ['b', 'c']);
  assert.deepEqual(plan.keep.map((k) => k.snapshot.id), ['a']);
});

test('planSnapshotSweep: never deletes a snapshot referenced by an in-flight agent_run', () => {
  const plan = planSnapshotSweep(
    [snap('old-running', 90)],
    [ref('old-running', 'task-1', 90, /*inFlight*/ true)],
    { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0 },
    NOW,
  );
  assert.equal(plan.delete.length, 0);
  assert.equal(plan.keep[0]!.reason, 'in-flight');
});

test('planSnapshotSweep: minKeepPerTask retains the N most recent per task even if old', () => {
  // Three attempts for task-A: 100/60/40 days old. minKeep=2 → 100d gets purged.
  const snapshots = [snap('A-100', 100), snap('A-60', 60), snap('A-40', 40)];
  const refs = [
    ref('A-100', 'task-A', 100),
    ref('A-60', 'task-A', 60),
    ref('A-40', 'task-A', 40),
  ];
  const plan = planSnapshotSweep(
    snapshots,
    refs,
    { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 2 },
    NOW,
  );
  assert.deepEqual(plan.delete.map((s) => s.id), ['A-100']);
  const keptIds = plan.keep.map((k) => k.snapshot.id);
  assert.ok(keptIds.includes('A-60'));
  assert.ok(keptIds.includes('A-40'));
  const reasonFor = (id: string) => plan.keep.find((k) => k.snapshot.id === id)?.reason;
  assert.equal(reasonFor('A-60'), 'min-keep-per-task');
  assert.equal(reasonFor('A-40'), 'min-keep-per-task');
});

test('planSnapshotSweep: minKeepPerTask is per-task (does not protect across tasks)', () => {
  const snapshots = [snap('A-60', 60), snap('B-60', 60)];
  const refs = [ref('A-60', 'task-A', 60), ref('B-60', 'task-B', 60)];
  const plan = planSnapshotSweep(
    snapshots,
    refs,
    { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 1 },
    NOW,
  );
  assert.equal(plan.delete.length, 0, 'each task has min-keep=1 satisfied independently');
});

test('planSnapshotSweep: orphan snapshots are deleted under delete-if-old (default)', () => {
  const snapshots = [snap('orphan-old', 90), snap('orphan-fresh', 5)];
  const plan = planSnapshotSweep(
    snapshots,
    [],
    { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0 },
    NOW,
  );
  assert.deepEqual(plan.delete.map((s) => s.id), ['orphan-old']);
  const kept = plan.keep.find((k) => k.snapshot.id === 'orphan-fresh');
  assert.equal(kept?.reason, 'recent');
});

test('planSnapshotSweep: orphan snapshots are kept under orphan-keep policy', () => {
  const plan = planSnapshotSweep(
    [snap('orphan-old', 90)],
    [],
    { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0, orphanPolicy: 'keep' },
    NOW,
  );
  assert.equal(plan.delete.length, 0);
  assert.equal(plan.keep[0]!.reason, 'orphan-kept');
});

test('planSnapshotSweep: corrupt index (createdAt=null) is treated as ancient and swept', () => {
  const corrupt: SnapshotMeta = { id: 'corrupt', createdAt: null, bytes: 500 };
  const plan = planSnapshotSweep([corrupt], [], DEFAULT_SWEEP_POLICY, NOW);
  assert.deepEqual(plan.delete.map((s) => s.id), ['corrupt']);
});

test('planSnapshotSweep: estimatedFreedBytes sums the delete set', () => {
  const plan = planSnapshotSweep(
    [snap('a', 90, 100), snap('b', 90, 200), snap('c', 5, 999)],
    [],
    { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0 },
    NOW,
  );
  assert.equal(plan.estimatedFreedBytes, 300);
});

// ----- runSnapshotSweep executor -----

class FakeStore implements SnapshotStoreOps {
  constructor(public snapshots: SnapshotMeta[]) {}
  readonly deleted: string[] = [];
  async listAll(): Promise<SnapshotMeta[]> { return this.snapshots; }
  async delete(id: string): Promise<{ freedBytes: number }> {
    const snap = this.snapshots.find((s) => s.id === id);
    if (!snap) return { freedBytes: 0 };
    this.deleted.push(id);
    this.snapshots = this.snapshots.filter((s) => s.id !== id);
    return { freedBytes: snap.bytes };
  }
}

class FakeRefs implements AgentRunsRefSource {
  constructor(public refs: AgentRunSnapshotRef[]) {}
  async listSnapshotRefs(): Promise<AgentRunSnapshotRef[]> { return this.refs; }
}

class CaptureLogger implements SnapshotSweepLogger {
  readonly entries: string[] = [];
  log(m: string): void { this.entries.push(m); }
  error(m: string): void { this.entries.push(`ERR ${m}`); }
}

test('runSnapshotSweep: deletes the planned snapshots and reports freed bytes', async () => {
  const store = new FakeStore([snap('keep', 5, 100), snap('purge', 90, 250)]);
  const refs = new FakeRefs([]);
  const logger = new CaptureLogger();
  const result = await runSnapshotSweep({
    store,
    runs: refs,
    policy: { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0 },
    logger,
    now: () => NOW,
  });
  assert.deepEqual(result.deleted, ['purge']);
  assert.equal(result.freedBytes, 250);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(store.deleted, ['purge']);
});

test('runSnapshotSweep: dryRun produces a plan but no deletions', async () => {
  const store = new FakeStore([snap('purge', 90)]);
  const refs = new FakeRefs([]);
  const result = await runSnapshotSweep({
    store,
    runs: refs,
    policy: { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0, dryRun: true },
    now: () => NOW,
  });
  assert.equal(result.plan.delete.length, 1);
  assert.equal(result.deleted.length, 0);
  assert.equal(store.deleted.length, 0);
});

test('runSnapshotSweep: collects per-id errors and continues', async () => {
  const store: SnapshotStoreOps = {
    async listAll() { return [snap('a', 90, 10), snap('b', 90, 20), snap('c', 90, 30)]; },
    async delete(id) {
      if (id === 'b') throw new Error('disk full');
      return { freedBytes: id === 'a' ? 10 : 30 };
    },
  };
  const result = await runSnapshotSweep({
    store,
    runs: new FakeRefs([]),
    policy: { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0 },
    now: () => NOW,
  });
  assert.deepEqual(result.deleted.sort(), ['a', 'c']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.id, 'b');
  assert.equal(result.freedBytes, 40);
});

// ----- starter -----

async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

test('startSnapshotRetentionSweep: runs immediately and on the interval, stop() is prompt', async () => {
  const store = new FakeStore([snap('purge', 90)]);
  const refs = new FakeRefs([]);
  const logger = new CaptureLogger();
  const handle = startSnapshotRetentionSweep({
    store,
    runs: refs,
    intervalMs: 60_000,
    policy: { ...DEFAULT_SWEEP_POLICY, maxAgeMs: 30 * DAY, minKeepPerTask: 0 },
    logger,
  });

  await waitFor(() => store.deleted.includes('purge'));
  const before = Date.now();
  await handle.stop();
  const elapsed = Date.now() - before;

  assert.ok(elapsed < 5_000, `stop() should not wait the full interval (took ${elapsed}ms)`);
  assert.ok(logger.entries.some((e) => e.startsWith('snapshot.sweep.ready')));
  assert.ok(logger.entries.some((e) => e.startsWith('snapshot.sweep.plan')));
  assert.ok(logger.entries.some((e) => e.startsWith('snapshot.sweep.done')));
  assert.ok(logger.entries.some((e) => e.startsWith('snapshot.sweep.stopped')));
});

test('startSnapshotRetentionSweep: a sweep error does not kill the loop', async () => {
  let calls = 0;
  const failingStore: SnapshotStoreOps = {
    async listAll() {
      calls += 1;
      if (calls === 1) throw new Error('list boom');
      return [];
    },
    async delete() { return { freedBytes: 0 }; },
  };
  const logger = new CaptureLogger();
  const handle = startSnapshotRetentionSweep({
    store: failingStore,
    runs: new FakeRefs([]),
    intervalMs: 30,
    logger,
  });
  await waitFor(() => calls >= 2, 2_000);
  await handle.stop();
  assert.ok(logger.entries.some((e) => e.startsWith('ERR snapshot.sweep.failed')));
});
