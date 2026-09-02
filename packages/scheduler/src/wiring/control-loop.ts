export interface ControlLoopDriver {
  pollOnce(): Promise<{ considered: number; routed: string[]; skipped: string[] }>;
}

export interface ControlLoopLogger {
  log(message: string): void;
  error(message: string): void;
}

export interface ControlLoopOptions {
  driver: ControlLoopDriver;
  pollIntervalMs: number;
  controlId: string;
  logger?: ControlLoopLogger;
  /** Optional now() injection for deterministic tests. */
  now?: () => number;
}

export interface ControlLoopHandle {
  /** Wait for the loop to drain after `stop()`. */
  done: Promise<void>;
  /**
   * Stop after the in-flight poll resolves. Cancels the sleep timer
   * immediately. Resolves once the loop's worker has exited.
   */
  stop: () => Promise<void>;
}

/**
 * Long-running poll loop for the control role. Wraps a single driver
 * (`BoardChannelDriver` today; future Slack/webhook drivers fold in here)
 * with idempotent retry-on-error and a clean shutdown. The driver's
 * `pollOnce()` is itself idempotent — `BoardChannelDriver` finds existing
 * sessions by conversation key, and the assignment router dedups on
 * `findByChannelOrigin`. Concurrent control processes therefore cannot
 * create duplicate worker sessions for the same task.
 */
export function startControlLoop(opts: ControlLoopOptions): ControlLoopHandle {
  const logger: ControlLoopLogger = opts.logger ?? {
    log: (m) => { process.stdout.write(`${m}\n`); },
    error: (m) => { process.stderr.write(`${m}\n`); },
  };
  const interval = Math.max(250, opts.pollIntervalMs);

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

  logger.log(`control.ready controlId=${opts.controlId} pollIntervalMs=${interval}`);

  const done = (async () => {
    while (!stopped) {
      const startedAt = (opts.now ?? Date.now)();
      logger.log(`control.poll_start controlId=${opts.controlId}`);
      try {
        const result = await opts.driver.pollOnce();
        const elapsed = (opts.now ?? Date.now)() - startedAt;
        logger.log(
          `control.poll_result controlId=${opts.controlId} considered=${result.considered} ` +
          `routed=${result.routed.length} skipped=${result.skipped.length} elapsedMs=${elapsed}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`control.poll_failed controlId=${opts.controlId} error=${message}`);
      }
      if (stopped) break;
      await sleep(interval);
    }
    logger.log(`control.stopped controlId=${opts.controlId}`);
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
