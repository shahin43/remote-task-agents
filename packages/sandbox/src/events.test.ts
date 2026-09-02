import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NullSandboxEventSink,
  SANDBOX_PHASE_TO_ATTEMPT_STATE,
  type SandboxEventSink,
  type SandboxEventPayload,
} from './events.js';

test('NullSandboxEventSink.emit resolves and does nothing', async () => {
  const sink = new NullSandboxEventSink();
  await sink.emit('sandbox.container.created', { sessionId: 'x', phase: 'created', backend: 'docker', at: 't' });
  assert.ok(true);
});

test('a collector sink satisfies SandboxEventSink structurally', async () => {
  const events: Array<{ type: string; payload: unknown }> = [];
  const sink: SandboxEventSink = { async emit(type, payload) { events.push({ type, payload }); } };
  await sink.emit('engine.message', { a: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'engine.message');
});

test('SandboxEventPayload carries rich container metadata structurally', () => {
  const payload: SandboxEventPayload = {
    sessionId: 's1', phase: 'created', backend: 'docker', at: '2026-06-06T00:00:00.000Z',
    container: { id: 'c123', image: 'remote-sandbox-agents/pi-agent:local', digest: 'sha256:aaa',
      identity: { name: 'remote-sandbox-agents/pi-agent:local', digest: 'sha256:aaa', engine: 'pi-agent', kind: 'pi-agent-guest', bundleSha256: 'deadbeef', gitSha: 'abc', contract: 'runner-protocol-v1' },
      labels: { project: 'remote-sandbox-agents' },
      resources: { cpus: '2', memoryMb: 4096, pids: 256 }, network: true },
    durationMs: 12,
  };
  assert.equal(payload.container?.image, 'remote-sandbox-agents/pi-agent:local');
  assert.equal(payload.container?.digest, 'sha256:aaa');
  assert.equal(payload.container?.identity?.engine, 'pi-agent');
  assert.equal(payload.container?.resources?.memoryMb, 4096);
});

test('every sandbox phase maps to a worker-attempt state (Hermes Gap #5)', () => {
  // Phases the sandbox actually emits, all covered; values are the Gap #5 vocabulary.
  assert.equal(SANDBOX_PHASE_TO_ATTEMPT_STATE.creating, 'starting_sandbox');
  assert.equal(SANDBOX_PHASE_TO_ATTEMPT_STATE.exec_attached, 'running_engine');
  assert.equal(SANDBOX_PHASE_TO_ATTEMPT_STATE.snapshotting, 'snapshotting');
  assert.equal(SANDBOX_PHASE_TO_ATTEMPT_STATE.destroyed, 'succeeded');
  assert.equal(SANDBOX_PHASE_TO_ATTEMPT_STATE.error, 'failed');
  // No phase maps to undefined.
  for (const state of Object.values(SANDBOX_PHASE_TO_ATTEMPT_STATE)) assert.ok(state.length > 0);
});
