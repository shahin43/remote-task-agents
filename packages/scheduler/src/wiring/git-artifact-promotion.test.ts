import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import type { SnapshotFileContent, SnapshotIndex, SnapshotStore } from '@remote-sandbox-agents/sandbox';
import { ProjectConfigRegistry } from './project-config.js';
import { promoteMrRequest } from './git-artifact-promotion.js';

const exec = promisify(execFile);

function memoryStore(files: Record<string, string>, restoreRootFiles?: (dest: string) => Promise<void>): SnapshotStore {
  return {
    storeType: 'local',
    persist: async () => ({ type: 'local', id: 'snap-1', location: '/tmp/snap-1' }),
    restorable: async () => true,
    restore: async (_ref, destRoot) => {
      if (restoreRootFiles) await restoreRootFiles(destRoot);
      return { schemaVersion: 1, id: 'snap-1', createdAt: 't', providerType: 'unix_local', artifacts: {}, restorable: true } satisfies SnapshotIndex;
    },
    readIndex: async () => ({ schemaVersion: 1, id: 'snap-1', createdAt: 't', providerType: 'unix_local', artifacts: {}, restorable: true }),
    listFiles: async () => Object.keys(files).map((p) => ({ path: p, source: 'sidecar' as const })),
    readFile: async (_ref, filePath) => {
      const content = files[filePath];
      if (content === undefined) throw new Error(`missing ${filePath}`);
      const body = Buffer.from(content);
      return { path: filePath, content, body, truncated: false } satisfies SnapshotFileContent;
    },
  };
}

test('promoteMrRequest writes changes.patch and branch.bundle from the snapshot', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'promo-'));
  const repoDir = path.join(tmp, 'src-repo');
  await fs.mkdir(repoDir);
  await exec('git', ['init'], { cwd: repoDir });
  await exec('git', ['config', 'user.email', 'dev@example.com'], { cwd: repoDir });
  await exec('git', ['config', 'user.name', 'Dev'], { cwd: repoDir });
  await fs.writeFile(path.join(repoDir, 'README.md'), 'hello\n');
  await exec('git', ['add', '.'], { cwd: repoDir });
  await exec('git', ['commit', '-m', 'init'], { cwd: repoDir });
  await fs.writeFile(path.join(repoDir, 'README.md'), 'hello world\n');
  await exec('git', ['add', '.'], { cwd: repoDir });
  await exec('git', ['commit', '-m', 'tweak'], { cwd: repoDir });

  const board = new InMemoryBoardStore();
  await board.upsertUser({ id: 'u1', tenantId: 't', projectId: 'p', kind: 'human', displayName: 'U', externalRefs: {} });
  const task = await board.createTask({
    tenantId: 'default',
    projectId: 'sample/service',
    title: 'Ship it',
    createdBy: 'u1',
    metadata: {
      repos: ['sample/service'],
      primaryRepo: 'sample/service',
      mrRequest: {
        status: 'pending_approval',
        fromAgentId: 'agent-coder',
        sessionId: 's1',
        snapshotRef: { type: 'local', id: 'snap-1', location: tmp },
        title: 'Add marker',
        summary: 'one-line e2e file',
        targetBranch: 'main',
        draft: true,
      },
    },
  });

  const store = memoryStore(
    {
      'git/branch.json': JSON.stringify({ workingBranch: 'agent/task-1' }),
      'git/changes.patch': 'diff --git a/README.md b/README.md\n+hello world\n',
    },
    async (dest) => {
      await fs.cp(repoDir, path.join(dest, 'repo'), { recursive: true });
    },
  );

  const result = await promoteMrRequest({
    taskId: task.id,
    board,
    projects: new ProjectConfigRegistry([
      {
        projectId: 'sample/service',
        tenantId: 'default',
        repos: [{ slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' }],
      },
    ]),
    projectId: 'sample/service',
    tenantId: 'default',
    defaultRepoSlug: 'sample/service',
    snapshotStore: store,
    by: 'u1',
    promotionRoot: path.join(tmp, 'out'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'opened');
  assert.ok(result.patchPath && (await fs.readFile(result.patchPath, 'utf8')).includes('hello world'));
  assert.ok(result.bundlePath && (await fs.stat(result.bundlePath)).isFile());
});
