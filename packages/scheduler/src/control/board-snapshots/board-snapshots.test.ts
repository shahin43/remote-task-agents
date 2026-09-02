import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LocalSnapshotStore } from '@remote-sandbox-agents/sandbox';
import { boardFileGroup, isBoardSnapshotPath } from './paths.js';
import { createSnapshotStoreRouter } from './store-router.js';
import { BoardSnapshotService } from './service.js';
import { zipStored } from './zip.js';

async function tarOf(dir: string): Promise<NodeJS.ReadableStream> {
  const child = spawn('tar', ['-cf', '-', '-C', dir, '.']);
  return child.stdout;
}

describe('board snapshot paths', () => {
  it('allowlists key files, artifacts, git sidecars, and repo/', () => {
    assert.equal(boardFileGroup('AGENTS.md'), 'key');
    assert.equal(boardFileGroup('.agent/handoff.json'), 'key');
    assert.equal(boardFileGroup('.agent/usage.json'), 'key');
    assert.equal(boardFileGroup('artifacts/topic-paper.md'), 'artifacts');
    assert.equal(boardFileGroup('git/changes.patch'), 'git');
    assert.equal(boardFileGroup('repo/src/index.ts'), 'repo');
    assert.equal(boardFileGroup('skills/chart/SKILL.md'), null);
    assert.equal(boardFileGroup('context/task-brief.md'), null);
    assert.equal(boardFileGroup('.agent/spec.json'), null);
    assert.equal(isBoardSnapshotPath('task/scope.json'), false);
  });
});

describe('BoardSnapshotService', () => {
  it('lists only board-visible files and zips artifacts', async () => {
    const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'board-snap-'));
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'board-ws-'));
    await fs.mkdir(path.join(ws, 'artifacts'), { recursive: true });
    await fs.mkdir(path.join(ws, 'repo'), { recursive: true });
    await fs.mkdir(path.join(ws, 'skills/hidden'), { recursive: true });
    await fs.writeFile(path.join(ws, 'AGENTS.md'), '# agent');
    await fs.writeFile(path.join(ws, 'SOUL.md'), '# soul');
    await fs.writeFile(path.join(ws, 'artifacts/summary.md'), 'done');
    await fs.writeFile(path.join(ws, 'repo/README.md'), 'repo');
    await fs.writeFile(path.join(ws, 'skills/hidden/SKILL.md'), 'nope');
    const store = new LocalSnapshotStore({ root: storeRoot });
    const ref = await store.persist({
      id: 'snap-board',
      createdAt: '2026-08-16T00:00:00.000Z',
      providerType: 'unix_local',
      workspaceTar: await tarOf(ws),
      sidecars: {},
      files: { 'git/changes.patch': 'diff x' },
    });
    const router = createSnapshotStoreRouter({
      local: store,
      persist: 'local',
      snapshotRoot: storeRoot,
    });
    const service = new BoardSnapshotService(router);
    const listed = await service.listBoardFiles(`local:${ref.id}`);
    const paths = listed.files.map((f) => f.path);
    assert.ok(paths.includes('AGENTS.md'));
    assert.ok(paths.includes('artifacts/summary.md'));
    assert.ok(paths.includes('repo/README.md'));
    assert.ok(paths.includes('git/changes.patch'));
    assert.ok(!paths.includes('SOUL.md'));
    assert.ok(!paths.some((p) => p.startsWith('skills/')));
    const zip = await service.zipArtifacts(`local:${ref.id}`);
    assert.ok(zip);
    assert.equal(zip.body.subarray(0, 2).toString(), 'PK');
    const workspace = await service.readWorkspaceArchive(`local:${ref.id}`);
    assert.ok(workspace);
    assert.equal(workspace.filename, `workspace-${ref.id}.tar`);
    assert.equal(workspace.contentType, 'application/x-tar');
    assert.ok(workspace.body.byteLength > 0);
    await assert.rejects(() => service.readBoardFile(`local:${ref.id}`, 'skills/hidden/SKILL.md'));
    await fs.rm(storeRoot, { recursive: true, force: true });
    await fs.rm(ws, { recursive: true, force: true });
  });
});

describe('zipStored', () => {
  it('writes a zip local-file signature', () => {
    const buf = zipStored([{ name: 'a.md', data: Buffer.from('hello') }]);
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
  });
});
