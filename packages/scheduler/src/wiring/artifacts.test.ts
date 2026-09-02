import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readArtifactsMaxEntries, resolveArtifacts } from './artifacts.js';

const snap = [
  'artifacts/paper.md',
  'artifacts/chart.svg',
  'artifacts/scratch.txt',
  'repo/src/index.ts',
  '.agent/handoff.json',
];

test('absent sidecar derives artifacts/** files, declared false', () => {
  const out = resolveArtifacts({ declared: undefined, snapshotPaths: snap });
  assert.equal(out.derived, true);
  assert.deepEqual(out.kept.map((a: { path: string }) => a.path), [
    'artifacts/chart.svg',
    'artifacts/paper.md',
    'artifacts/scratch.txt',
  ]);
  assert.ok(out.kept.every((a: { declared: boolean }) => a.declared === false));
  assert.equal(out.kept.filter((a: { primary: boolean }) => a.primary).length, 1);
  assert.equal(out.kept.find((a: { path: string }) => a.path === 'artifacts/paper.md')?.primary, true);
});

test('derive skips harness artifacts/summary.md', () => {
  const out = resolveArtifacts({
    declared: undefined,
    snapshotPaths: [...snap, 'artifacts/summary.md'],
  });
  assert.ok(!out.kept.some((a: { path: string }) => a.path === 'artifacts/summary.md'));
});

test('declared sidecar keeps only listed valid paths; does not derive siblings', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/paper.md', title: 'Paper', primary: true },
        { path: 'artifacts/chart.svg', title: 'Chart' },
      ],
    },
    snapshotPaths: snap,
  });
  assert.equal(out.derived, false);
  assert.equal(out.kept.length, 2);
  assert.ok(!out.kept.some((a: { path: string }) => a.path === 'artifacts/scratch.txt'));
  assert.equal(out.kept[0]?.primary, true);
});

test('drops traversal, non-artifacts, missing, and directory paths with a reason', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/../repo/secret' },
        { path: 'repo/src/index.ts' },
        { path: 'artifacts/nope.md' },
        { path: 'artifacts/' },
        { path: 12 },
      ],
    },
    snapshotPaths: snap,
  });
  assert.equal(out.kept.length, 0);
  assert.ok(out.dropped.some((d: { reason: string }) => d.reason === 'not_under_artifacts'));
  assert.ok(out.dropped.some((d: { reason: string }) => d.reason === 'missing'));
  assert.ok(out.dropped.some((d: { reason: string }) => d.reason === 'malformed'));
});

test('empty declared array keeps nothing (does not derive)', () => {
  const out = resolveArtifacts({ declared: { artifacts: [] }, snapshotPaths: snap });
  assert.equal(out.derived, false);
  assert.equal(out.kept.length, 0);
});

test('declared object without artifacts does not derive', () => {
  const out = resolveArtifacts({ declared: {}, snapshotPaths: snap });
  assert.equal(out.derived, false);
  assert.equal(out.kept.length, 0);
});

test('previewDeliverables alias is accepted as declared', () => {
  const out = resolveArtifacts({
    declared: {
      previewDeliverables: [
        { path: 'artifacts/paper.md', title: 'Paper', primary: true },
      ],
    },
    snapshotPaths: snap,
  });
  assert.equal(out.derived, false);
  assert.deepEqual(out.kept, [
    { path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true },
  ]);
});

test('top-level array sidecar is accepted as declared', () => {
  const out = resolveArtifacts({
    declared: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true }],
    snapshotPaths: snap,
  });
  assert.equal(out.derived, false);
  assert.equal(out.kept[0]?.path, 'artifacts/paper.md');
  assert.equal(out.kept[0]?.declared, true);
});

test('truncated artifacts sidecar is repaired and kept as declared', () => {
  const out = resolveArtifacts({
    declared: {
      __invalidJson: true,
      raw: '{"artifacts":[{"path":"artifacts/paper.md","title":"Paper","primary":true}]',
    },
    snapshotPaths: snap,
  });
  assert.equal(out.derived, false);
  assert.equal(out.kept[0]?.path, 'artifacts/paper.md');
  assert.equal(out.kept[0]?.declared, true);
});

test('unrepairable invalid sidecar derives from snapshot files', () => {
  const out = resolveArtifacts({
    declared: { __invalidJson: true, raw: '{oops' },
    snapshotPaths: snap,
  });
  assert.equal(out.derived, true);
  assert.ok(out.kept.some((a: { path: string }) => a.path === 'artifacts/paper.md'));
  assert.ok(out.kept.every((a: { declared: boolean }) => a.declared === false));
});

test('malformed sidecar (not object) derives', () => {
  const out = resolveArtifacts({ declared: 'nope', snapshotPaths: snap });
  assert.equal(out.derived, true);
  assert.ok(out.kept.length > 0);
});

test('caps extra entries', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/paper.md' },
        { path: 'artifacts/chart.svg' },
        { path: 'artifacts/scratch.txt' },
      ],
    },
    snapshotPaths: snap,
    maxEntries: 2,
  });
  assert.equal(out.kept.length, 2);
  assert.ok(out.dropped.some((d: { reason: string }) => d.reason === 'cap'));
});

test('second primary is coerced false', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/paper.md', primary: true },
        { path: 'artifacts/chart.svg', primary: true },
      ],
    },
    snapshotPaths: snap,
  });
  assert.equal(out.kept.filter((a: { primary: boolean }) => a.primary).length, 1);
  assert.equal(out.kept[0]?.primary, true);
  assert.equal(out.kept[1]?.primary, false);
});

test('readArtifactsMaxEntries defaults to 32 and parses env', () => {
  assert.equal(readArtifactsMaxEntries({}), 32);
  assert.equal(readArtifactsMaxEntries({ REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES: '8' }), 8);
  assert.equal(readArtifactsMaxEntries({ REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES: 'nope' }), 32);
});
