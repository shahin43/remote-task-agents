import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUsageTotals, rollupTaskUsage } from './token-usage.js';
import type { AgentRunRecord } from '@remote-sandbox-agents/persistence';

test('extractUsageTotals reads Pi engine usage shape', () => {
  assert.deepEqual(
    extractUsageTotals({ input: 10, output: 5, cost: { total: 0.001 } }),
    { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
  );
});

test('rollupTaskUsage sums attempts and ignores missing cost', () => {
  const run = (partial: Partial<AgentRunRecord>): AgentRunRecord =>
    ({
      id: 'r1',
      sessionId: 's',
      taskId: 't',
      attemptNumber: 1,
      status: 'succeeded',
      agentSpecId: 'coder',
      backend: null,
      sandboxSessionId: null,
      containerId: null,
      workspaceLocation: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      sandboxReadyAt: null,
      endedAt: null,
      durationMs: null,
      snapshotRef: null,
      summary: null,
      error: null,
      finishReason: null,
      tokenUsage: null,
      toolsUsed: null,
      guestImage: null,
      skillsUsed: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...partial,
    }) as AgentRunRecord;
  const view = rollupTaskUsage('t1', [
    run({ id: 'a', attemptNumber: 1, tokenUsage: { input: 100, output: 20, cost: { total: 0.02 } } }),
    run({ id: 'b', attemptNumber: 2, agentSpecId: 'reviewer', tokenUsage: { input: 50, output: 10 } }),
  ]);
  assert.equal(view.inputTokens, 150);
  assert.equal(view.outputTokens, 30);
  assert.equal(view.totalTokens, 180);
  assert.equal(view.costUsd, 0.02);
  assert.equal(view.attemptCount, 2);
});
