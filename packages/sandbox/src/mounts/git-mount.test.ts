import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createManifest } from '../manifest.js';
import { UnixLocalSandboxProvider } from '../providers/unix-local.js';
import { GitMount, parseGitMountEntry } from './git-mount.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function makeOriginRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-origin-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(dir, 'README.md'), 'origin');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  // ensure branch is named main
  git(dir, 'branch', '-M', 'main');
  return dir;
}

describe('GitMount', () => {
  let root: string;
  let origin: string;
  let provider: UnixLocalSandboxProvider;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-ws-'));
    origin = await makeOriginRepo();
    provider = new UnixLocalSandboxProvider({ workspacesRoot: root, idFactory: () => 'g1' });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(origin, { recursive: true, force: true });
  });

  it('clones the origin and checks out the working branch', async () => {
    const session = await provider.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'unix_local' } });
    await session.start();
    const mount = new GitMount({
      type: 'git_mount', provider: 'local', repo: origin, baseRef: 'main',
      dest: 'repo', workingBranch: 'agent/test-g1',
    });
    await mount.activate(session);
    const ws = session.state.workspaceRoot;
    assert.equal(await fs.readFile(path.join(ws, 'repo/README.md'), 'utf8'), 'origin');
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path.join(ws, 'repo') }).toString().trim();
    assert.equal(branch, 'agent/test-g1');
    await provider.destroy(session);
  });

  it('capture() returns branch metadata and a diff after a local commit', async () => {
    const session = await provider.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'unix_local' } });
    await session.start();
    const mount = new GitMount({
      type: 'git_mount', provider: 'local', repo: origin, baseRef: 'main',
      dest: 'repo', workingBranch: 'agent/test-g1',
    });
    await mount.activate(session);
    const ws = session.state.workspaceRoot;
    await fs.writeFile(path.join(ws, 'repo/new.txt'), 'change');
    git(path.join(ws, 'repo'), 'add', '.');
    git(path.join(ws, 'repo'), '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '-m', 'work');
    const meta = await mount.capture(session);
    assert.equal(meta.workingBranch, 'agent/test-g1');
    assert.ok(typeof meta.baseSha === 'string' && (meta.baseSha as string).length > 0);
    assert.ok((meta.changesPatch as string).includes('new.txt'));
    await provider.destroy(session);
  });

  it('parseGitMountEntry rejects an absolute dest', () => {
    assert.throws(
      () => parseGitMountEntry({ type: 'git_mount', provider: 'local', repo: '/x', baseRef: 'main', dest: '/abs', workingBranch: 'b' }),
      /workspace-relative/,
    );
  });
});
