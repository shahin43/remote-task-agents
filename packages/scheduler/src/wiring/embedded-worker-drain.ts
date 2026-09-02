export interface EmbeddedWorkerDrainDeps {
  /** Atomic claim + run for one routing session. Returns null when idle. */
  claimAndRun(): Promise<{ sessionId: string; status: string } | null>;
  /** Sweep expired leases (best-effort). */
  reapExpiredLeases(): Promise<number>;
}

export interface EmbeddedWorkerDrainLogger {
  log(message: string): void;
  error(message: string): void;
}

export interface EmbeddedWorkerDrainOptions {
  scheduler: EmbeddedWorkerDrainDeps;
  pollIntervalMs: number;
  /**
   * Initial lease reap before the first claim, plus a periodic sweep timer.
   * Defaults to max(30s, min(pollIntervalMs*6, 120s)).
   */
  reapIntervalMs?: number;
  logger?: EmbeddedWorkerDrainLogger;
}

export interface EmbeddedWorkerDrainHandle {
  done: Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Local-dev "all-in-one" worker drain that ships inside `--role api`. Logs
 * are namespaced `api.dev_worker_*` so production accidents (forgetting
 * `--with-worker` is local-dev-only) are visually obvious in service logs.
 *
 * Production SaaS deployments must run `--role worker` as a separate process
 * instead; the two share the same `WorkerScheduler.claimAndRun()` atomic
 * claim path so concurrent claimers do not double-run a session.
 */
export function startEmbeddedWorkerDrain(opts: EmbeddedWorkerDrainOptions): EmbeddedWorkerDrainHandle {
  const logger: EmbeddedWorkerDrainLogger = opts.logger ?? {
    log: (m) => { process.stdout.write(`${m}\n`); },
    error: (m) => { process.stderr.write(`${m}\n`); },
  };
  const poll = Math.max(250, opts.pollIntervalMs);
  const reapMs = opts.reapIntervalMs ?? Math.max(30_000, Math.min(poll * 6, 120_000));

  let stopped = false;
  let cancelSleep: (() => void) | null = null;

  const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cancelSleep = null;
      resolve();
    }, ms);
    cancelSleep = () => {
      clearTimeout(timer);
      cancelSleep = null;
      resolve();
    };
  });

  void opts.scheduler.reapExpiredLeases().catch((err) => {
    logger.error(`api.dev_worker_reap_failed error=${formatError(err)}`);
  });

  const reaper = setInterval(() => {
    void opts.scheduler.reapExpiredLeases().catch((err) => {
      logger.error(`api.dev_worker_reap_failed error=${formatError(err)}`);
    });
  }, reapMs);

  logger.log('api.dev_worker_ready');

  const done = (async () => {
    while (!stopped) {
      try {
        const result = await opts.scheduler.claimAndRun();
        if (result) {
          logger.log(`api.dev_worker_run ${JSON.stringify(result)}`);
          continue;
        }
      } catch (err) {
        logger.error(`api.dev_worker_run_failed error=${formatError(err)}`);
      }
      if (stopped) break;
      await sleep(poll);
    }
    clearInterval(reaper);
    logger.log('api.dev_worker_stopped');
  })();

  return {
    done,
    stop: async () => {
      stopped = true;
      cancelSleep?.();
      clearInterval(reaper);
      await done;
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
