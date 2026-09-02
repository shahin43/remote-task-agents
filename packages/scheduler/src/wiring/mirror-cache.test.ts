import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureGitSeedRepo, makeMirrorCache } from './mirror-cache.js';

test('ensureGitSeedRepo materializes a git repo from a template directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-'));
  const template = path.join(root, 'template');
  const seed = path.join(root, 'seed');
  await fs.mkdir(template, { recursive: true });
  await fs.writeFile(path.join(template, 'README.md'), '# hello\n');

  const resolved = await ensureGitSeedRepo(seed, template);
  assert.equal(resolved, seed);
  assert.match(await fs.readFile(path.join(seed, 'README.md'), 'utf8'), /hello/);
  await fs.access(path.join(seed, '.git', 'HEAD'));
});

test('makeMirrorCache bootstraps a bare mirror from an ensured seed repo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirror-'));
  const template = path.join(root, 'template');
  const seed = path.join(root, 'seed');
  await fs.mkdir(template, { recursive: true });
  await fs.writeFile(path.join(template, 'README.md'), '# mirror me\n');
  await ensureGitSeedRepo(seed, template);

  const mirrorFor = makeMirrorCache({
    cacheRoot: path.join(root, 'mirrors'),
    sourceFor: async () => seed,
  });
  const mirrorPath = await mirrorFor('sample/service');
  assert.match(mirrorPath, /sample__service\.git$/);
  await fs.access(path.join(mirrorPath, 'HEAD'));
});
