import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LocalSnapshotStore } from './local-snapshot.js';

async function tarOf(dir: string): Promise<NodeJS.ReadableStream> {
  const child = spawn('tar', ['-cf', '-', '-C', dir, '.']);
  return child.stdout;
}

describe('LocalSnapshotStore', () => {
  let storeRoot: string;
  let wsDir: string;
  let store: LocalSnapshotStore;

  beforeEach(async () => {
    storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-store-'));
    wsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-ws-'));
    await fs.writeFile(path.join(wsDir, 'file.txt'), 'snapshot me');
    store = new LocalSnapshotStore({ root: storeRoot });
  });

  afterEach(async () => {
    await fs.rm(storeRoot, { recursive: true, force: true });
    await fs.rm(wsDir, { recursive: true, force: true });
  });

  it('persists workspace tar + sidecars + files and writes a checksummed index', async () => {
    const ref = await store.persist({
      id: 'sess-1',
      createdAt: '2026-06-04T00:00:00.000Z',
      providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir),
      sidecars: { 'session.json': { threadId: 't1', summary: 'done' } },
      files: { 'transcript.jsonl': '{"a":1}\n', 'git/changes.patch': 'diff --git ...' },
    });
    assert.equal(ref.type, 'local');
    assert.equal(ref.id, 'sess-1');
    const index = await store.readIndex(ref);
    assert.equal(index.restorable, true);
    assert.ok(index.artifacts['workspace.tar']);
    assert.ok(index.artifacts['session.json']);
    assert.ok(index.artifacts['transcript.jsonl']);
    assert.ok(index.artifacts['git/changes.patch']);
  });

  it('restore extracts the workspace tar into destRoot', async () => {
    const ref = await store.persist({
      id: 'sess-2', createdAt: '2026-06-04T00:00:00.000Z', providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir), sidecars: {}, files: {},
    });
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-restore-'));
    const index = await store.restore(ref, dest);
    assert.equal(index.id, 'sess-2');
    assert.equal(await fs.readFile(path.join(dest, 'file.txt'), 'utf8'), 'snapshot me');
    await fs.rm(dest, { recursive: true, force: true });
  });

  it('restorable() is false when an artifact checksum mismatches', async () => {
    const ref = await store.persist({
      id: 'sess-3', createdAt: '2026-06-04T00:00:00.000Z', providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir), sidecars: { 'session.json': { ok: true } }, files: {},
    });
    // Corrupt a stored artifact.
    await fs.writeFile(path.join(ref.location, 'session.json'), '{"tampered":true}');
    assert.equal(await store.restorable(ref), false);
  });

  it('listFiles returns sidecars and workspace tar members', async () => {
    const ref = await store.persist({
      id: 'sess-4',
      createdAt: '2026-06-04T00:00:00.000Z',
      providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir),
      sidecars: {},
      files: { 'git/changes.patch': 'diff --git a/file.txt' },
    });
    const files = await store.listFiles(ref);
    assert.ok(files.some((f) => f.path === 'git/changes.patch' && f.source === 'sidecar'));
    assert.ok(files.some((f) => f.path === 'file.txt' && f.source === 'workspace'));
  });

  it('listAll enumerates every snapshot under the store root with createdAt + bytes', async () => {
    await store.persist({
      id: 'sess-list-a', createdAt: '2026-06-01T00:00:00.000Z', providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir), sidecars: {}, files: {},
    });
    await store.persist({
      id: 'sess-list-b', createdAt: '2026-06-15T00:00:00.000Z', providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir), sidecars: {}, files: { 'extra.txt': 'hello' },
    });
    // An orphan directory with no snapshot.json should still be enumerated
    // (so the retention sweep can decide what to do with it).
    await fs.mkdir(path.join(storeRoot, 'sess-orphan'), { recursive: true });
    await fs.writeFile(path.join(storeRoot, 'sess-orphan', 'garbage.bin'), 'rubbish');

    const all = await store.listAll();
    const byId = new Map(all.map((s) => [s.id, s]));
    assert.equal(byId.get('sess-list-a')?.createdAt, '2026-06-01T00:00:00.000Z');
    assert.equal(byId.get('sess-list-b')?.createdAt, '2026-06-15T00:00:00.000Z');
    assert.equal(byId.get('sess-orphan')?.createdAt, null);
    assert.ok((byId.get('sess-list-b')?.bytes ?? 0) >= (byId.get('sess-list-a')?.bytes ?? 0));
    assert.ok((byId.get('sess-orphan')?.bytes ?? 0) > 0);
  });

  it('delete removes the snapshot directory and returns freed bytes; double-delete is a no-op', async () => {
    const ref = await store.persist({
      id: 'sess-del', createdAt: '2026-06-01T00:00:00.000Z', providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir), sidecars: {}, files: { 'note.txt': 'x'.repeat(100) },
    });
    const first = await store.delete(ref.id);
    assert.ok(first.freedBytes > 0);
    const exists = await fs.access(ref.location).then(() => true).catch(() => false);
    assert.equal(exists, false);
    // Idempotent: deleting again must not throw and reports zero bytes.
    const second = await store.delete(ref.id);
    assert.equal(second.freedBytes, 0);
  });

  it('readFile reads sidecars and workspace tar members', async () => {
    const ref = await store.persist({
      id: 'sess-5',
      createdAt: '2026-06-04T00:00:00.000Z',
      providerType: 'unix_local',
      workspaceTar: await tarOf(wsDir),
      sidecars: {},
      files: { 'git/changes.patch': 'diff content' },
    });
    const sidecar = await store.readFile(ref, 'git/changes.patch');
    assert.equal(sidecar.content, 'diff content');
    assert.equal(sidecar.body.toString('utf8'), 'diff content');
    const workspace = await store.readFile(ref, 'file.txt');
    assert.equal(workspace.content, 'snapshot me');
    assert.equal(workspace.body.toString('utf8'), 'snapshot me');
  });
});
