import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectConfig } from './project-config.js';
import {
  catalogFromProject,
  defaultRepoSlugsForProject,
  normalizeTaskRepoWrite,
  parseTaskRepoSelection,
  repoSlugsToMounts,
  resolveTaskRepoSlugs,
  taskRepoMetadataPatch,
} from './task-repo-selection.js';

const project: ProjectConfig = {
  projectId: 'p1',
  tenantId: 't1',
  defaultRepos: ['sample/service'],
  repos: [
    { slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' },
    { slug: 'sample/shared-lib', provider: 'local', baseBranch: 'main', dest: 'shared-lib' },
  ],
};

test('parseTaskRepoSelection reads metadata repos and primaryRepo', () => {
  const sel = parseTaskRepoSelection({
    repos: ['sample/shared-lib', 'sample/service'],
    primaryRepo: 'sample/shared-lib',
  });
  assert.deepEqual(sel, {
    repos: ['sample/shared-lib', 'sample/service'],
    primaryRepo: 'sample/shared-lib',
  });
});

test('resolveTaskRepoSlugs falls back to project defaultRepos', () => {
  assert.deepEqual(resolveTaskRepoSlugs({}, project), ['sample/service']);
});

test('repoSlugsToMounts maps slugs to git mount requests', () => {
  const mounts = repoSlugsToMounts(['sample/shared-lib'], project);
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0]!.ref, 'sample/shared-lib');
  assert.equal(mounts[0]!.dest, 'shared-lib');
});

test('taskRepoMetadataPatch is channel-stable', () => {
  assert.deepEqual(taskRepoMetadataPatch({ repos: ['a'], primaryRepo: 'a' }), {
    repos: ['a'],
    primaryRepo: 'a',
  });
});

test('catalogFromProject marks default repos', () => {
  const catalog = catalogFromProject(project);
  assert.equal(catalog.length, 2);
  assert.equal(catalog.find((e) => e.slug === 'sample/service')?.isDefault, true);
});

test('normalizeTaskRepoWrite rejects unknown slug', () => {
  assert.throws(
    () => normalizeTaskRepoWrite({ repos: ['sample/unknown'] }, project),
    /Unknown repo slug/,
  );
});
