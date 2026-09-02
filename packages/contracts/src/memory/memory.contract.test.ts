import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemoryProposal, MemorySnapshot } from '../index.js';

test('MemoryProposal survives JSON round-trip', () => {
  const proposal: MemoryProposal = {
    key: 'build-tool',
    content: 'This repo uses pnpm, not npm. Lock file is pnpm-lock.yaml.',
    sourceRunId: 'ENG-123-attempt-1',
    confidence: 0.9,
    proposedAt: '2026-05-17T10:30:00.000Z',
  };

  const serialized = JSON.stringify(proposal);
  const deserialized: MemoryProposal = JSON.parse(serialized);

  assert.deepEqual(deserialized, proposal);
  assert.equal(typeof deserialized.confidence, 'number');
});

test('MemorySnapshot survives JSON round-trip', () => {
  const snapshot: MemorySnapshot = {
    content: '# Memory\n\n- Uses pnpm\n- Deploys via Vercel',
    loadedAt: '2026-05-17T09:00:00.000Z',
    charCount: 45,
  };

  const serialized = JSON.stringify(snapshot);
  const deserialized: MemorySnapshot = JSON.parse(serialized);

  assert.deepEqual(deserialized, snapshot);
});

test('MemoryProposal confidence is between 0 and 1', () => {
  const proposal: MemoryProposal = {
    key: 'test',
    content: 'test',
    sourceRunId: 'r1',
    confidence: 0.75,
    proposedAt: '2026-05-17T10:00:00.000Z',
  };

  assert.ok(proposal.confidence >= 0 && proposal.confidence <= 1);
});
