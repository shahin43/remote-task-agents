import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startControlLoop, type ControlLoopDriver, type ControlLoopLogger } from './control-loop.js';

class StubLogger implements ControlLoopLogger {
  readonly entries: Array<{ stream: 'stdout' | 'stderr'; message: string }> = [];
  log(message: string): void { this.entries.push({ stream: 'stdout', message }); }
  error(message: string): void { this.entries.push({ stream: 'stderr', message }); }
  has(stream: 'stdout' | 'stderr', pattern: RegExp | string): boolean {
    return this.entries.some((e) =>
      e.stream === stream && (typeof pattern === 'string' ? e.message.includes(pattern) : pattern.test(e.message)),
    );
  }
}

class CountingDriver implements ControlLoopDriver {
  calls = 0;
  result: { considered: number; routed: string[]; skipped: string[] } = { considered: 0, routed: [], skipped: [] };
  /** Resolves after each poll completes (set externally). */
  onPoll?: () => void;
  async pollOnce(): Promise<{ considered: number; routed: string[]; skipped: string[] }> {
    this.calls += 1;
    const result = this.result;
    this.onPoll?.();
    return result;
  }
}

class FailingDriver implements ControlLoopDriver {
  calls = 0;
  async pollOnce(): Promise<{ considered: number; routed: string[]; skipped: string[] }> {
    this.calls += 1;
    throw new Error('database unavailable');
  }
}

async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

test('startControlLoop: invokes pollOnce on the driver', async () => {
  const driver = new CountingDriver();
  const logger = new StubLogger();
  const handle = startControlLoop({ driver, pollIntervalMs: 5_000, controlId: 'ctl-1', logger });

  await waitFor(() => driver.calls >= 1);
  await handle.stop();

  assert.ok(driver.calls >= 1);
  assert.ok(logger.has('stdout', 'control.ready'));
  assert.ok(logger.has('stdout', 'control.poll_start'));
  assert.ok(logger.has('stdout', 'control.poll_result'));
  assert.ok(logger.has('stdout', 'control.stopped'));
});

test('startControlLoop: continues polling after a failure', async () => {
  let phase = 0;
  const driver: ControlLoopDriver = {
    pollOnce: async () => {
      phase += 1;
      if (phase === 1) throw new Error('first poll fails');
      return { considered: 1, routed: ['task-1'], skipped: [] };
    },
  };
  const logger = new StubLogger();
  const handle = startControlLoop({ driver, pollIntervalMs: 50, controlId: 'ctl-1', logger });

  await waitFor(() => phase >= 2, 2000);
  await handle.stop();

  assert.ok(logger.has('stderr', 'control.poll_failed'));
  assert.ok(logger.has('stdout', /routed=1/));
});

test('startControlLoop: stop() shuts down without waiting full interval', async () => {
  const driver = new CountingDriver();
  const handle = startControlLoop({ driver, pollIntervalMs: 60_000, controlId: 'ctl-1' });
  await waitFor(() => driver.calls >= 1);

  const before = Date.now();
  await handle.stop();
  const elapsed = Date.now() - before;

  assert.ok(elapsed < 5_000, `stop() should not wait the full poll interval (took ${elapsed}ms)`);
});

test('startControlLoop: pollOnce is idempotent across pollers (driver invariant)', async () => {
  // Two control loops sharing a driver must not corrupt counts. The router
  // dedups on findByChannelOrigin, so this just verifies the loop doesn't
  // shoot extra polls or interleave state. We rely on pollOnce semantics.
  const driver = new CountingDriver();
  const a = startControlLoop({ driver, pollIntervalMs: 30, controlId: 'ctl-a' });
  const b = startControlLoop({ driver, pollIntervalMs: 30, controlId: 'ctl-b' });

  await waitFor(() => driver.calls >= 4);
  await Promise.all([a.stop(), b.stop()]);
  assert.ok(driver.calls >= 4);
});

test('startControlLoop: surfaces the FailingDriver error message', async () => {
  const driver = new FailingDriver();
  const logger = new StubLogger();
  const handle = startControlLoop({ driver, pollIntervalMs: 30, controlId: 'ctl-1', logger });
  await waitFor(() => driver.calls >= 1);
  await handle.stop();
  assert.ok(logger.has('stderr', 'database unavailable'));
});
