import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderDescriptor, ProviderActionRecord } from '../index.js';

test('ProviderDescriptor survives JSON round-trip', () => {
  const descriptor: ProviderDescriptor = {
    kind: 'board',
    provider: 'linear',
    mode: 'api',
    configured: true,
    credentialRefs: ['env:LINEAR_API_KEY'],
    allowedActions: ['updateRunStatus', 'appendRunComment'],
  };

  const serialized = JSON.stringify(descriptor);
  const deserialized: ProviderDescriptor = JSON.parse(serialized);

  assert.deepEqual(deserialized, descriptor);
});

test('ProviderActionRecord survives JSON round-trip', () => {
  const record: ProviderActionRecord = {
    kind: 'repo',
    provider: 'local',
    action: 'publishDraftMergeRequest',
    status: 'succeeded',
    message: 'MR !42 created',
    externalId: '42',
    externalUrl: 'https://git.example.com/org/sample/-/merge_requests/42',
  };

  const serialized = JSON.stringify(record);
  const deserialized: ProviderActionRecord = JSON.parse(serialized);

  assert.deepEqual(deserialized, record);
  assert.equal(deserialized.status, 'succeeded');
});

test('ProviderDescriptor kind covers board, repo, channel', () => {
  const kinds: ProviderDescriptor['kind'][] = ['board', 'repo', 'channel'];
  assert.equal(kinds.length, 3);
});
