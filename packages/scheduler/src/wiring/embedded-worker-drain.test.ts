import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startEmbeddedWorkerDrain,
  type EmbeddedWorkerDrainDeps,
  type EmbeddedWorkerDrainLogger,
} from './embedded-worker-drain.js';

class StubLogger implements EmbeddedWorkerDrainLogger {
  readonly entries: Array<{ stream: 'stdout' | 'stderr'; message: string }> = [];
  log(message: string): void { this.entries.push({ stream: 'stdout', message }); }
  error(message: string): void { this.entries.push({ stream: 'stderr', message }); }
  has(stream: 'stdout' | 'stderr', pattern: RegExp | string): boolean {
    return this.entries.some((e) =>
      e.stream === stream && (typeof pattern === 'string' ? e.message.includes(pattern) : pattern.test(e.message)),
    );
  }
}

class StubScheduler implements EmbeddedWorkerDrainDeps {
  claimCalls = 0;
  reapCalls = 0;
  nextResults: Array<{ sessionId: string; status: string } | null> = [];
  async claimAndRun(): Promise<{ sessionId: string; status: string } | null> {
    this.claimCalls += 1;
    return this.nextResults.shift() ?? null;
  }
  async reapExpiredLeases(): Promise<number> {
    this.reapCalls += 1;
    return 0;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}

test('startEmbeddedWorkerDrain: polls claimAndRun and logs dev_worker_* messages', async () => {
  const scheduler = new StubScheduler();
  scheduler.nextResults = [{ sessionId: 's1', status: 'succeeded' }];
  const logger = new StubLogger();
  const handle = startEmbeddedWorkerDrain({ scheduler, pollIntervalMs: 30, logger });

  await waitFor(() => scheduler.claimCalls >= 2);
  await handle.stop();

  assert.ok(logger.has('stdout', 'api.dev_worker_ready'));
  assert.ok(logger.has('stdout', 'api.dev_worker_run'));
  assert.ok(logger.has('stdout', 'api.dev_worker_stopped'));
  assert.ok(scheduler.reapCalls >= 1);
});

test('startEmbeddedWorkerDrain: stop() does not wait the full poll interval', async () => {
  const scheduler = new StubScheduler();
  const handle = startEmbeddedWorkerDrain({ scheduler, pollIntervalMs: 60_000 });
  await waitFor(() => scheduler.claimCalls >= 1);

  const before = Date.now();
  await handle.stop();
  const elapsed = Date.now() - before;
  assert.ok(elapsed < 5_000, `stop() should not wait the full poll interval (took ${elapsed}ms)`);
});

test('startEmbeddedWorkerDrain: error in claimAndRun does not kill the loop', async () => {
  let phase = 0;
  const scheduler: EmbeddedWorkerDrainDeps = {
    claimAndRun: async () => {
      phase += 1;
      if (phase === 1) throw new Error('claim boom');
      if (phase === 2) return { sessionId: 's1', status: 'succeeded' };
      // From phase 3 on, idle so the drain enters its poll sleep and the
      // test can shut down cleanly without spinning a hot loop.
      return null;
    },
    reapExpiredLeases: async () => 0,
  };
  const logger = new StubLogger();
  const handle = startEmbeddedWorkerDrain({ scheduler, pollIntervalMs: 30, logger });

  await waitFor(() => phase >= 3);
  await handle.stop();

  assert.ok(logger.has('stderr', 'api.dev_worker_run_failed'));
  assert.ok(logger.has('stdout', 'api.dev_worker_run'));
});
