import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createManifest } from '../manifest.js';
import { UnixLocalSandboxProvider } from './unix-local.js';
import { execOk } from '../types.js';

describe('UnixLocalSandboxProvider', () => {
  let root: string;
  let srcDir: string;
  let provider: UnixLocalSandboxProvider;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-root-'));
    srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-src-'));
    await fs.writeFile(path.join(srcDir, 'hello.txt'), 'hi');
    provider = new UnixLocalSandboxProvider({ workspacesRoot: root, idFactory: () => 'sess-1' });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(srcDir, { recursive: true, force: true });
  });

  it('alignOwnership with writeAccess: ro strips write bits across the workspace tree', async () => {
    const manifest = createManifest({
      entries: {
        'README.md': { type: 'inline_file', dest: 'README.md', content: 'hello\n' },
        'tree': { type: 'local_dir', src: srcDir, dest: 'tree' },
      },
      env: {},
      workspace: { writeAccess: 'ro' },
    });
    const session = await provider.create({ manifest, options: { type: 'unix_local' } });
    await session.start();
    const ws = session.state.workspaceRoot;
    // Top-level inline file must be unwritable for the host user.
    await assert.rejects(
      () => fs.writeFile(path.join(ws, 'README.md'), 'mutated'),
      /EACCES|EPERM/,
    );
    // Nested file from a local_dir copy must also be unwritable.
    await assert.rejects(
      () => fs.writeFile(path.join(ws, 'tree/hello.txt'), 'mutated'),
      /EACCES|EPERM/,
    );
    // Reads still work — the traversal/exec bits are preserved.
    assert.equal(await fs.readFile(path.join(ws, 'README.md'), 'utf8'), 'hello\n');
    // destroy() restores write bits before fs.rm, so no manual cleanup needed.
    await provider.destroy(session);
  });

  it('alignOwnership with writeAccess: rw leaves files writable (the default)', async () => {
    const manifest = createManifest({
      entries: { 'README.md': { type: 'inline_file', dest: 'README.md', content: 'hi' } },
      env: {},
      workspace: { writeAccess: 'rw' },
    });
    const session = await provider.create({ manifest, options: { type: 'unix_local' } });
    await session.start();
    const ws = session.state.workspaceRoot;
    await fs.writeFile(path.join(ws, 'README.md'), 'edited');
    assert.equal(await fs.readFile(path.join(ws, 'README.md'), 'utf8'), 'edited');
    await provider.destroy(session);
  });

  it('local_dir copy of a 0444 git object is writable (no EACCES chmod on bind mounts)', async () => {
    const objDir = path.join(srcDir, '.git', 'objects', '6f');
    await fs.mkdir(objDir, { recursive: true });
    const srcObj = path.join(objDir, 'b17bd23bcb1a68b40aeda6e7bb5420f5f1848d');
    await fs.writeFile(srcObj, 'blob');
    await fs.chmod(srcObj, 0o444);
    const manifest = createManifest({
      entries: { repo: { type: 'local_dir', src: srcDir, dest: 'repo' } },
      env: {},
    });
    const session = await provider.create({ manifest, options: { type: 'unix_local' } });
    await session.start();
    const destObj = path.join(
      session.state.workspaceRoot,
      'repo/.git/objects/6f/b17bd23bcb1a68b40aeda6e7bb5420f5f1848d',
    );
    await fs.writeFile(destObj, 'rewritten');
    assert.equal(await fs.readFile(destObj, 'utf8'), 'rewritten');
    await provider.destroy(session);
  });

  it('materializes local_file, local_dir, and inline_file entries on start()', async () => {
    const manifest = createManifest({
      entries: {
        'a/hello.txt': { type: 'local_file', src: path.join(srcDir, 'hello.txt'), dest: 'a/hello.txt' },
        'tree': { type: 'local_dir', src: srcDir, dest: 'tree' },
        'AGENTS.md': { type: 'inline_file', dest: 'AGENTS.md', content: '# Worker instructions\n' },
      },
      env: {},
    });
    const session = await provider.create({ manifest, options: { type: 'unix_local' } });
    await session.start();
    const ws = session.state.workspaceRoot;
    assert.equal(await fs.readFile(path.join(ws, 'a/hello.txt'), 'utf8'), 'hi');
    assert.equal(await fs.readFile(path.join(ws, 'tree/hello.txt'), 'utf8'), 'hi');
    assert.equal(await fs.readFile(path.join(ws, 'AGENTS.md'), 'utf8'), '# Worker instructions\n');
    await provider.destroy(session);
  });

  it('exec runs a command in the workspace and returns ExecResult', async () => {
    const session = await provider.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'unix_local' } });
    await session.start();
    await session.write('note.txt', 'content');
    const r = await session.exec('cat note.txt');
    assert.ok(execOk(r));
    assert.equal(r.stdout.trim(), 'content');
    await provider.destroy(session);
  });

  it('exec passes env and respects cwd', async () => {
    const session = await provider.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'unix_local' } });
    await session.start();
    const r = await session.exec('echo $MYVAR', { env: { MYVAR: 'xyz' } });
    assert.equal(r.stdout.trim(), 'xyz');
    await provider.destroy(session);
  });

  it('persistWorkspace yields a tar that contains workspace files', async () => {
    const session = await provider.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'unix_local' } });
    await session.start();
    await session.write('keep.txt', 'data');
    const tarStream = await session.persistWorkspace();
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-untar-'));
    const tarPath = path.join(out, 'ws.tar');
    const { createWriteStream } = await import('node:fs');
    await new Promise<void>((resolve, reject) => {
      const w = createWriteStream(tarPath);
      tarStream.pipe(w);
      w.on('finish', () => resolve());
      w.on('error', reject);
    });
    const { execFileSync } = await import('node:child_process');
    execFileSync('tar', ['-xf', tarPath, '-C', out]);
    // tar stores paths relative to workspace root; keep.txt should exist somewhere under out
    const found = await fs.readFile(path.join(out, 'keep.txt'), 'utf8').catch(() => null);
    assert.equal(found, 'data');
    await provider.destroy(session);
    await fs.rm(out, { recursive: true, force: true });
  });

  it('destroy removes the workspace directory', async () => {
    const session = await provider.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'unix_local' } });
    await session.start();
    const ws = session.state.workspaceRoot;
    await provider.destroy(session);
    await assert.rejects(() => fs.access(ws));
  });

  it('serializeState/deserializeState round-trip', () => {
    const state = { type: 'unix_local', sessionId: 's', workspaceRoot: '/w', workspaceRootOwned: true };
    const json = provider.serializeState(state);
    const back = provider.deserializeState(json);
    assert.deepEqual(back, state);
  });
});
