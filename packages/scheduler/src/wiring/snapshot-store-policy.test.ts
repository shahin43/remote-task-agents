import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSnapshotStorePolicy } from './snapshot-store-policy.js';

test('local snapshots are allowed for Docker and unix-local', () => {
  assert.doesNotThrow(() =>
    assertSnapshotStorePolicy({ store: 'local', deployment: 'local', runtime: 'sandbox-docker' }),
  );
  assert.doesNotThrow(() =>
    assertSnapshotStorePolicy({ store: 'local', deployment: 'local', runtime: 'sandbox-unix-local' }),
  );
});
