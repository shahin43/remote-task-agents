/**
 * Snapshot retention sweep.
 *
 * Closes the "snapshot store grows unbounded" item in ARCHITECTURE.md §15
 * by giving operators a default age-based LRU with two safety rails:
 *
 *  1. **Live-attempt protection.** A snapshot referenced by an `agent_runs`
 *     row whose status is NOT in {`succeeded`,`failed`} is never deleted —
 *     the worker may still be writing to it (race on `markSandboxReady` →
 *     `finalize`) or be about to hand it to `hydrateWorkspace` on a
 *     follow-up.
 *  2. **Min-keep-per-task.** The most-recent N snapshots for each task are
 *     always retained, even if they're older than `maxAgeMs`. This keeps
 *     follow-up resume working — the spec describes
 *     `resumeWorkspace: true` reading `lastSnapshotRef`, so the latest
 *     attempt's snapshot must survive a sweep regardless of age.
 *
 * The planner is a pure function (no I/O). The executor applies the plan
 * via a tiny `SnapshotStoreOps` port, and a starter wraps both behind a
 * timer for the `--role worker` process (the role that owns the local
 * snapshot directory in single-host SaaS Stage 1; multi-host stores move
 * to S3 + a cron in Stage 2).
 */

export interface SnapshotMeta {
  id: string;
  /** ISO timestamp the snapshot was written. `null` ⇒ orphan (no snapshot.json). */
  createdAt: string | null;
  bytes: number;
}

export interface AgentRunSnapshotRef {
  /** Snapshot id this run references via `agent_runs.snapshot_ref->>id`. */
  snapshotId: string;
  taskId: string | null;
  /** True when the run is still in-flight (status NOT IN succeeded/failed). */
  inFlight: boolean;
  /** Used by the min-keep policy to find the N most-recent attempts per task. */
  startedAt: string;
}

export interface SnapshotSweepPolicy {
  /** Snapshots older than this are candidates for deletion. Default 30 days. */
  maxAgeMs: number;
  /** Minimum snapshots to keep per task even if older than `maxAgeMs`. Default 3. */
  minKeepPerTask: number;
  /**
   * What to do with snapshots that have no matching `agent_runs` row at all.
   * - `delete-if-old`: subject to the same `maxAgeMs` check (default).
   * - `keep`: never delete orphans (forensic mode).
   */
  orphanPolicy: 'delete-if-old' | 'keep';
  /** Default false. If true, the planner emits a plan but the executor is a no-op. */
  dryRun: boolean;
}

export type SnapshotKeepReason =
  | 'recent'
  | 'min-keep-per-task'
  | 'in-flight'
  | 'orphan-kept';

export interface SnapshotSweepPlan {
  delete: SnapshotMeta[];
  keep: Array<{ snapshot: SnapshotMeta; reason: SnapshotKeepReason }>;
  /** Sum of `bytes` over the `delete` set — operators want this in their dashboards. */
  estimatedFreedBytes: number;
}

export const DEFAULT_SWEEP_POLICY: SnapshotSweepPolicy = {
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  minKeepPerTask: 3,
  orphanPolicy: 'delete-if-old',
  dryRun: false,
};

/**
 * Pure planner. Returns the snapshots to delete + keep + a freed-bytes
 * estimate. No I/O. Easy to unit-test against any policy.
 */
export function planSnapshotSweep(
  snapshots: SnapshotMeta[],
  refs: AgentRunSnapshotRef[],
  policy: SnapshotSweepPolicy = DEFAULT_SWEEP_POLICY,
  now: number = Date.now(),
): SnapshotSweepPlan {
  const inFlightIds = new Set<string>();
  const refsByTask = new Map<string, AgentRunSnapshotRef[]>();
  for (const ref of refs) {
    if (ref.inFlight) inFlightIds.add(ref.snapshotId);
    if (ref.taskId) {
      const list = refsByTask.get(ref.taskId) ?? [];
      list.push(ref);
      refsByTask.set(ref.taskId, list);
    }
  }

  // For each task, mark the N most-recent (by startedAt desc) snapshot ids
  // as "protected by min-keep". A min-keep slot can only be filled by a
  // run that actually has a snapshot, so the worker that succeeded with no
  // snapshot does not eat the slot.
  const minKeepIds = new Set<string>();
  for (const [, taskRefs] of refsByTask) {
    const sorted = [...taskRefs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    for (const ref of sorted.slice(0, policy.minKeepPerTask)) {
      minKeepIds.add(ref.snapshotId);
    }
  }

  const referencedIds = new Set<string>(refs.map((r) => r.snapshotId));

  const cutoff = now - policy.maxAgeMs;
  const del: SnapshotMeta[] = [];
  const keep: SnapshotSweepPlan['keep'] = [];
  for (const snap of snapshots) {
    if (inFlightIds.has(snap.id)) {
      keep.push({ snapshot: snap, reason: 'in-flight' });
      continue;
    }
    if (minKeepIds.has(snap.id)) {
      keep.push({ snapshot: snap, reason: 'min-keep-per-task' });
      continue;
    }
    // Treat snapshots with no createdAt as ancient (they predate the index
    // or are corrupted) so the orphan policy still applies to them.
    const ageMs = snap.createdAt ? now - Date.parse(snap.createdAt) : Number.POSITIVE_INFINITY;
    if (ageMs < policy.maxAgeMs) {
      keep.push({ snapshot: snap, reason: 'recent' });
      continue;
    }
    const isOrphan = !referencedIds.has(snap.id);
    if (isOrphan && policy.orphanPolicy === 'keep') {
      keep.push({ snapshot: snap, reason: 'orphan-kept' });
      continue;
    }
    if (ageMs > policy.maxAgeMs || (isOrphan && policy.orphanPolicy === 'delete-if-old' && ageMs > policy.maxAgeMs)) {
      // age check already gated this above; this branch keeps the logic explicit.
      del.push(snap);
      continue;
    }
    // Fallthrough (shouldn't hit): keep with `recent` to be safe.
    void cutoff;
    keep.push({ snapshot: snap, reason: 'recent' });
  }

  const estimatedFreedBytes = del.reduce((sum, s) => sum + s.bytes, 0);
  return { delete: del, keep, estimatedFreedBytes };
}

export interface SnapshotStoreOps {
  listAll(): Promise<SnapshotMeta[]>;
  delete(id: string): Promise<{ freedBytes: number }>;
}

export interface AgentRunsRefSource {
  /**
   * Return one `AgentRunSnapshotRef` per `agent_runs` row that carries a
   * `snapshot_ref->>id`. The implementation typically does a single SQL
   * query that pulls (snapshot_id, task_id, status, started_at).
   */
  listSnapshotRefs(): Promise<AgentRunSnapshotRef[]>;
}

export interface SnapshotSweepLogger {
  log(message: string): void;
  error(message: string): void;
}

export interface SnapshotSweepResult {
  plan: SnapshotSweepPlan;
  deleted: string[];
  errors: Array<{ id: string; error: string }>;
  freedBytes: number;
}

/**
 * Execute a planned sweep. Errors on individual deletes are collected and
 * surfaced rather than aborting the whole sweep — a single corrupt
 * snapshot directory should not prevent reclaiming the other 99% of
 * disk space.
 */
export async function runSnapshotSweep(deps: {
  store: SnapshotStoreOps;
  runs: AgentRunsRefSource;
  policy?: SnapshotSweepPolicy;
  logger?: SnapshotSweepLogger;
  now?: () => number;
}): Promise<SnapshotSweepResult> {
  const policy = deps.policy ?? DEFAULT_SWEEP_POLICY;
  const logger = deps.logger ?? {
    log: (m) => process.stdout.write(`${m}\n`),
    error: (m) => process.stderr.write(`${m}\n`),
  };
  const now = deps.now?.() ?? Date.now();

  const [snapshots, refs] = await Promise.all([deps.store.listAll(), deps.runs.listSnapshotRefs()]);
  const plan = planSnapshotSweep(snapshots, refs, policy, now);
  logger.log(
    `snapshot.sweep.plan considered=${snapshots.length} delete=${plan.delete.length} ` +
    `keep=${plan.keep.length} estimated_freed_bytes=${plan.estimatedFreedBytes} dry_run=${policy.dryRun}`,
  );

  if (policy.dryRun) {
    return { plan, deleted: [], errors: [], freedBytes: 0 };
  }

  const deleted: string[] = [];
  const errors: SnapshotSweepResult['errors'] = [];
  let freedBytes = 0;
  for (const snap of plan.delete) {
    try {
      const result = await deps.store.delete(snap.id);
      deleted.push(snap.id);
      freedBytes += result.freedBytes;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ id: snap.id, error: message });
      logger.error(`snapshot.sweep.delete_failed id=${snap.id} error=${message}`);
    }
  }
  logger.log(`snapshot.sweep.done deleted=${deleted.length} freed_bytes=${freedBytes} errors=${errors.length}`);
  return { plan, deleted, errors, freedBytes };
}

export interface SnapshotSweepStarterOptions {
  store: SnapshotStoreOps;
  runs: AgentRunsRefSource;
  intervalMs: number;
  policy?: SnapshotSweepPolicy;
  logger?: SnapshotSweepLogger;
}

export interface SnapshotSweepHandle {
  done: Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Long-running starter. Runs an immediate sweep, then sleeps `intervalMs`
 * between sweeps until `stop()` is called. Sweep failures are logged and
 * never bring down the host process — that follows the same robustness
 * contract as the control loop and the embedded worker drain.
 */
export function startSnapshotRetentionSweep(opts: SnapshotSweepStarterOptions): SnapshotSweepHandle {
  // Library takes the caller's interval as-is so tests can run fast. The
  // production wiring layer (see scheduler/index.ts) clamps this to a
  // sensible floor (>= 60s) via env var.
  const interval = opts.intervalMs;
  const logger: SnapshotSweepLogger = opts.logger ?? {
    log: (m) => process.stdout.write(`${m}\n`),
    error: (m) => process.stderr.write(`${m}\n`),
  };

  let stopped = false;
  let cancelSleep: (() => void) | null = null;
  const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { cancelSleep = null; resolve(); }, ms);
    cancelSleep = () => { clearTimeout(timer); cancelSleep = null; resolve(); };
  });

  logger.log(`snapshot.sweep.ready intervalMs=${interval}`);

  const done = (async () => {
    while (!stopped) {
      try {
        await runSnapshotSweep({ store: opts.store, runs: opts.runs, policy: opts.policy, logger });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`snapshot.sweep.failed error=${message}`);
      }
      if (stopped) break;
      await sleep(interval);
    }
    logger.log('snapshot.sweep.stopped');
  })();

  return {
    done,
    stop: async () => {
      stopped = true;
      cancelSleep?.();
      await done;
    },
  };
}
