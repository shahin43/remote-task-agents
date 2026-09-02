import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockerCreateLabels } from './docker.js';

test('dockerCreateLabels always includes project and session_id', () => {
  const labels = dockerCreateLabels('sess-1', { type: 'docker' });
  assert.equal(labels.project, 'remote-sandbox-agents');
  assert.equal(labels.session_id, 'sess-1');
});

test('dockerCreateLabels merges ownership labels from provider options', () => {
  const labels = dockerCreateLabels('sess-1', {
    type: 'docker',
    labels: {
      run_id: 'run-9',
      worker_id: 'worker-3',
      lease_generation: '2',
      attempt: '1',
    },
  });
  assert.equal(labels.run_id, 'run-9');
  assert.equal(labels.worker_id, 'worker-3');
  assert.equal(labels.lease_generation, '2');
  assert.equal(labels.attempt, '1');
});

test('dockerCreateLabels ignores empty and non-string extra labels', () => {
  const labels = dockerCreateLabels('sess-1', {
    type: 'docker',
    labels: { run_id: '', worker_id: 7, ok: 'yes' },
  });
  assert.equal(labels.run_id, undefined);
  assert.equal(labels.worker_id, undefined);
  assert.equal(labels.ok, 'yes');
});
