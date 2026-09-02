import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSessionState, parseSessionState } from './session.js';
import type { StreamHandle, SandboxSession } from './session.js';

describe('SandboxSessionState', () => {
  it('makeSessionState builds a typed, serializable state', () => {
    const s = makeSessionState('unix_local', 'sess-1', '/tmp/ws', { extra: 42 });
    assert.equal(s.type, 'unix_local');
    assert.equal(s.sessionId, 'sess-1');
    assert.equal(s.workspaceRoot, '/tmp/ws');
    assert.equal((s as Record<string, unknown>).extra, 42);
  });

  it('round-trips through JSON', () => {
    const s = makeSessionState('unix_local', 'sess-1', '/tmp/ws', {});
    const parsed = parseSessionState(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(parsed, s);
  });

  it('parseSessionState rejects missing type/sessionId', () => {
    assert.throws(() => parseSessionState({ sessionId: 'x', workspaceRoot: '/w' }), /type/);
    assert.throws(() => parseSessionState({ type: 'unix_local', workspaceRoot: '/w' }), /sessionId/);
  });
});

test('StreamHandle and optional spawnStream are part of the contract', () => {
  // Type-only: a structural object must satisfy StreamHandle.
  const fake = {
    stdin: process.stdin as unknown as NodeJS.WritableStream,
    stdout: process.stdout as unknown as NodeJS.ReadableStream,
    stderr: process.stderr as unknown as NodeJS.ReadableStream,
    kill: (_signal?: NodeJS.Signals) => {},
    exitCode: Promise.resolve(0 as number | null),
  };
  const handle: StreamHandle = fake;
  assert.ok(handle.stdin && handle.stdout && handle.stderr);
  // spawnStream is optional on the session.
  const hasSpawn: keyof SandboxSession = 'spawnStream';
  assert.equal(hasSpawn, 'spawnStream');
});
