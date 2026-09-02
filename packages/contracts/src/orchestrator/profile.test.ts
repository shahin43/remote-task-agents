import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkerRuntimeKind } from './profile.js';

test('WorkerRuntimeKind includes the sandbox backends', () => {
  const kinds: WorkerRuntimeKind[] = [
    'local',
    'docker',
    'remote',
    'sandbox-unix-local',
    'sandbox-docker',
  ];
  assert.equal(kinds.length, 5);
  const k: WorkerRuntimeKind = 'sandbox-docker';
  assert.equal(k, 'sandbox-docker');
});
