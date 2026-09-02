import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEventRecord } from '@remote-sandbox-agents/contracts';
import { buildAttemptViews } from './session-attempts.js';

function ev(
  eventIndex: number,
  eventType: SessionEventRecord['eventType'],
  kind: string,
  payload: unknown,
): SessionEventRecord {
  return {
    sessionId: 's1',
    eventIndex,
    eventType,
    kind,
    payload,
    createdAt: `2026-06-28T00:00:${String(eventIndex).padStart(2, '0')}.000Z`,
  };
}

test('buildAttemptViews splits worker_start/worker_end and attaches follow-up inputs', () => {
  const events: SessionEventRecord[] = [
    ev(0, 'input', 'channel.input', { text: 'First task' }),
    ev(1, 'turn', 'worker_start', { startedAt: '2026-06-28T00:00:01.000Z' }),
    ev(2, 'turn', 'assistant_message', { role: 'assistant', content: [{ type: 'text', text: 'Done first' }] }),
    ev(3, 'turn', 'worker_end', {
      status: 'succeeded',
      summary: 'Done first',
      durationMs: 1000,
      snapshotRef: { type: 'local', id: 'snap-1', location: '/snaps/snap-1' },
    }),
    ev(4, 'input', 'run.summary', { text: '## Prior run (attempt 1)\nStatus: succeeded' }),
    ev(5, 'input', 'channel.input', { text: 'Follow up please' }),
    ev(6, 'turn', 'worker_start', { startedAt: '2026-06-28T00:01:00.000Z' }),
    ev(7, 'turn', 'worker_end', { status: 'succeeded', summary: 'Done second', durationMs: 900 }),
  ];

  const attempts = buildAttemptViews(events);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0]!.channelInputs, ['First task']);
  assert.equal(attempts[0]!.assistantSummary, 'Done first');
  assert.equal(attempts[0]!.snapshotRefEncoded, 'local:snap-1');
  assert.equal(attempts[1]!.priorSummary?.includes('Prior run'), true);
  assert.deepEqual(attempts[1]!.channelInputs, ['Follow up please']);
});
