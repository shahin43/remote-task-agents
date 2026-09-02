import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFailureSummary } from './format-failure-summary.js';

test('prefixes raw error when no summary is available', () => {
  const text = formatFailureSummary(undefined, 'docker exec EPIPE');
  assert.equal(text, 'Agent run failed: docker exec EPIPE');
});

test('combines error + summary when both are present and disjoint', () => {
  const text = formatFailureSummary('Tried to write summary.md but workspace was read-only', 'EACCES: permission denied');
  assert.equal(
    text,
    'Agent run failed: EACCES: permission denied\n\nTried to write summary.md but workspace was read-only',
  );
});

test('does not duplicate the error when the summary already mentions it', () => {
  const summary = 'Tool failed with EACCES: permission denied while writing summary.md';
  const text = formatFailureSummary(summary, 'EACCES: permission denied');
  assert.equal(text, `Agent run failed: ${summary}`);
});

test('falls back to a generic message when nothing is provided', () => {
  const text = formatFailureSummary(undefined, undefined);
  assert.match(text, /Agent run failed without a recoverable summary/);
});

test('preserves existing "Agent run failed" prefix in the summary', () => {
  const summary = 'Agent run failed: container exited before turn completion';
  const text = formatFailureSummary(summary, undefined);
  assert.equal(text, summary);
});
