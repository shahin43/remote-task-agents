import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceTarUri } from './snapshot.js';

test('workspaceTarUri appends workspace.tar for absolute snapshot locations', () => {
  assert.equal(
    workspaceTarUri({ type: 'local', location: '/tmp/snapshots/abc' }),
    '/tmp/snapshots/abc/workspace.tar',
  );
});

test('workspaceTarUri appends workspace.tar for local snapshot dirs', () => {
  assert.equal(
    workspaceTarUri({ type: 'local', location: '/runs/snapshots/abc' }),
    '/runs/snapshots/abc/workspace.tar',
  );
});
