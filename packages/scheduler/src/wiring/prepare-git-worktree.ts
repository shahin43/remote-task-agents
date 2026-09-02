import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyTreeOwned } from '@remote-sandbox-agents/sandbox';

const exec = promisify(execFile);

export interface PrepareGitWorktreeOptions {
  /** Host path to a bare mirror or ordinary git checkout. */
  mirrorPath: string;
  baseRef: string;
  workingBranch: string;
  /** Host directory for the prepared checkout (created if missing). */
  rootDir: string;
}

/**
 * Materialize a host-side git checkout from a local mirror before sandbox start.
 *
 * Clone into the container overlay (`os.tmpdir()`), then byte-copy onto `rootDir`.
 * Git chmod's objects to 0444; that fails with EACCES on Docker bind-mounts
 * (`./runs`) when `USER app` is not the host inode owner.
 */
export async function prepareGitWorktree(opts: PrepareGitWorktreeOptions): Promise<string> {
  const head = path.join(opts.rootDir, '.git');
  if (await fs.stat(head).then(() => true).catch(() => false)) {
    return opts.rootDir;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'git-wt-'));
  const tmpRepo = path.join(tmp, 'repo');
  try {
    await exec('git', [
      'clone',
      '--no-hardlinks',
      '--depth',
      '1',
      '--branch',
      opts.baseRef,
      opts.mirrorPath,
      tmpRepo,
    ]);
    await exec('git', ['-C', tmpRepo, 'checkout', '-b', opts.workingBranch]);
    await fs.mkdir(path.dirname(opts.rootDir), { recursive: true });
    await copyTreeOwned(tmpRepo, opts.rootDir);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  return opts.rootDir;
}
