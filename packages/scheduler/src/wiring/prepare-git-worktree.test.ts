import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { prepareGitWorktree } from './prepare-git-worktree.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function firstLooseObject(repo: string): Promise<string> {
  const objects = path.join(repo, '.git', 'objects');
  for (const bucket of await fs.readdir(objects)) {
    if (bucket === 'info' || bucket === 'pack') continue;
    const dir = path.join(objects, bucket);
    const files = await fs.readdir(dir);
    if (files[0]) return path.join(dir, files[0]);
  }
  throw new Error('no loose git object');
}

test('prepareGitWorktree clones without hardlinking mirror objects', async () => {
  const origin = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-origin-'));
  git(origin, 'init', '-q');
  git(origin, 'config', 'user.email', 'test@example.com');
  git(origin, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(origin, 'README.md'), 'origin');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'init');
  git(origin, 'branch', '-M', 'main');

  const rootDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'wt-dest-')), 'repo');
  await prepareGitWorktree({
    mirrorPath: origin,
    baseRef: 'main',
    workingBranch: 'agent/task-1',
    rootDir,
  });

  const originObj = await firstLooseObject(origin);
  const rel = originObj.slice(origin.length);
  const clonedObj = path.join(rootDir, rel);
  const originIno = (await fs.stat(originObj)).ino;
  const clonedIno = (await fs.stat(clonedObj)).ino;
  assert.notEqual(originIno, clonedIno, 'clone must not hardlink git objects onto a bind-mounted runs volume');

  await fs.rm(origin, { recursive: true, force: true });
  await fs.rm(path.dirname(rootDir), { recursive: true, force: true });
});
