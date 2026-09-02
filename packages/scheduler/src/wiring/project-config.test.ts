import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectConfigRegistry, normalizeProjectConfig } from './project-config.js';

test('normalizeProjectConfig fills repo dest defaults', () => {
  const config = normalizeProjectConfig({
    projectId: 'p1',
    tenantId: 't1',
    repos: [{ slug: 'sample/service', provider: 'local', baseBranch: 'main' }],
  });
  assert.equal(config.repos[0]!.dest, 'service');
});

test('ProjectConfigRegistry fallback uses default repo slug', () => {
  const registry = new ProjectConfigRegistry();
  const config = registry.fallback('unknown', 't1', 'sample/service');
  assert.equal(config.repos[0]!.slug, 'sample/service');
  assert.equal(config.repos[0]!.dest, 'repo');
});
