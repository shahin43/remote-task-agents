import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createManifest } from './manifest.js';
import { UnixLocalSandboxProvider } from './providers/unix-local.js';
import { LocalSnapshotStore } from './snapshot/local-snapshot.js';
import { SandboxManager } from './manager.js';
// Import git-mount for its registerMount/registerEntryParser side effects.
import './mounts/git-mount.js';

function git(cwd: string, ...args: string[]): void { execFileSync('git', args, { cwd, stdio: 'ignore' }); }
async function makeOrigin(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-origin-'));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@e.c'); git(dir, 'config', 'user.name', 'T');
  await fs.writeFile(path.join(dir, 'README.md'), 'origin');
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'init'); git(dir, 'branch', '-M', 'main');
  return dir;
}

describe('SandboxManager', () => {
  let wsRoot: string; let snapRoot: string; let origin: string; let manager: SandboxManager;

  beforeEach(async () => {
    wsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-ws-'));
    snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-snap-'));
    origin = await makeOrigin();
    let n = 0;
    const provider = new UnixLocalSandboxProvider({ workspacesRoot: wsRoot, idFactory: () => `sess-${++n}` });
    manager = new SandboxManager({
      providers: [provider],
      snapshotStore: new LocalSnapshotStore({ root: snapRoot }),
      clock: () => '2026-06-04T00:00:00.000Z',
    });
  });

  afterEach(async () => {
    await fs.rm(wsRoot, { recursive: true, force: true });
    await fs.rm(snapRoot, { recursive: true, force: true });
    await fs.rm(origin, { recursive: true, force: true });
  });

  it('create() materializes entries and activates a git mount', async () => {
    const manifest = createManifest({
      entries: { repo: { type: 'git_mount', provider: 'local', repo: origin, baseRef: 'main', dest: 'repo', workingBranch: 'agent/x' } },
      env: {},
    });
    const session = await manager.create({ manifest, options: { type: 'unix_local' } });
    const ws = session.state.workspaceRoot;
    assert.equal(await fs.readFile(path.join(ws, 'repo/README.md'), 'utf8'), 'origin');
    await manager.destroy(session);
  });

  it('snapshot() persists workspace + git capture + sidecars, and is restorable', async () => {
    const manifest = createManifest({
      entries: { repo: { type: 'git_mount', provider: 'local', repo: origin, baseRef: 'main', dest: 'repo', workingBranch: 'agent/x' } },
      env: {},
    });
    const session = await manager.create({ manifest, options: { type: 'unix_local' } });
    const ws = session.state.workspaceRoot;
    await fs.writeFile(path.join(ws, 'repo/new.txt'), 'work');
    git(path.join(ws, 'repo'), 'add', '.');
    git(path.join(ws, 'repo'), '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '-m', 'work');

    const ref = await manager.snapshot(session, { sidecars: { 'session.json': { summary: 'done' } }, files: { 'transcript.jsonl': '{}\n' } });
    assert.ok(await manager.snapshotStore.restorable(ref));
    const index = await manager.snapshotStore.readIndex(ref);
    assert.ok(index.artifacts['git/changes.patch'], 'git diff captured');
    assert.ok(index.artifacts['git/branch.json'], 'branch metadata captured');
    assert.ok(index.artifacts['session.json']);
    await manager.destroy(session);
  });

  it('throws for an unknown provider options type', async () => {
    await assert.rejects(
      () => manager.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'nope' } }),
      /no provider registered/,
    );
  });
});
