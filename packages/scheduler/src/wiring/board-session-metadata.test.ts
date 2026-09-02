import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import { AgentConfigLoader } from '@remote-sandbox-agents/orchestrator';
import type { CatalogSkill } from '@remote-sandbox-agents/skills';
import { makeResolveTargetAsync } from './resolve-target.js';
import { ProjectConfigRegistry } from './project-config.js';
import { buildBoardSessionMetadata } from './board-session-metadata.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerAssetsRoot = path.resolve(here, '../../../..');

test('makeResolveTargetAsync maps agent profile_id to worker target', async () => {
  const board = new InMemoryBoardStore();
  await board.upsertAgent({
    id: 'agent-coder',
    tenantId: 't1',
    projectId: 'p1',
    profileId: 'coding-default',
    displayName: 'Coder',
  });
  const loader = new AgentConfigLoader({ serviceDefaultRoot: workerAssetsRoot });
  const resolve = makeResolveTargetAsync({ board, configLoader: loader });
  const task = await board.createTask({ tenantId: 't1', projectId: 'p1', title: 'T', createdBy: 'u1' });
  await board.assignTask({ taskId: task.id, assigneeKind: 'agent', assigneeId: 'agent-coder', assignedBy: 'u1' });
  const updated = await board.getTask(task.id);
  const target = await resolve(updated!);
  assert.equal(target.kind, 'worker');
  if (target.kind === 'worker') assert.equal(target.agentSpecId, 'coding-default');
});

test('buildBoardSessionMetadata includes effectiveScope mounts and contextFiles', async () => {
  const projects = new ProjectConfigRegistry([{
    projectId: 'p1',
    tenantId: 't1',
    repos: [
      { slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' },
      { slug: 'sample/other', provider: 'local', baseBranch: 'main', dest: 'other' },
    ],
  }]);
  const loader = new AgentConfigLoader({ serviceDefaultRoot: workerAssetsRoot });
  const task = {
    id: 'task-1',
    tenantId: 't1',
    projectId: 'p1',
    title: 'Fix bug',
    body: 'details',
    status: 'backlog' as const,
    priority: 'medium' as const,
    assigneeKind: 'agent' as const,
    assigneeId: 'agent-coder',
    createdBy: 'u1',
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const meta = await buildBoardSessionMetadata(
    { projects, configLoader: loader, defaultRepoSlug: 'sample/service' },
    task,
    { kind: 'worker', agentSpecId: 'coder' },
  );
  const eff = meta.effectiveScope as { mounts: Array<{ ref: string; dest: string }> };
  assert.equal(eff.mounts.length, 1);
  assert.equal(eff.mounts[0]!.ref, 'sample/service');
  assert.equal(eff.mounts[0]!.dest, 'repo');
  const contextFiles = meta.contextFiles as Array<{ path: string }>;
  assert.ok(contextFiles.some((f) => f.path === 'context/task-brief.md'));
});

test('buildBoardSessionMetadata respects task metadata.repos subset', async () => {
  const projects = new ProjectConfigRegistry([{
    projectId: 'p1',
    tenantId: 't1',
    repos: [
      { slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' },
      { slug: 'sample/shared-lib', provider: 'local', baseBranch: 'main', dest: 'shared-lib' },
    ],
  }]);
  const loader = new AgentConfigLoader({ serviceDefaultRoot: workerAssetsRoot });
  const task = {
    id: 'task-1',
    tenantId: 't1',
    projectId: 'p1',
    title: 'Fix bug',
    body: 'details',
    status: 'backlog' as const,
    priority: 'medium' as const,
    assigneeKind: 'agent' as const,
    assigneeId: 'agent-coder',
    createdBy: 'u1',
    metadata: { repos: ['sample/shared-lib'], primaryRepo: 'sample/shared-lib' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const meta = await buildBoardSessionMetadata(
    { projects, configLoader: loader, defaultRepoSlug: 'sample/service' },
    task,
    { kind: 'human' },
  );
  const eff = meta.effectiveScope as { mounts: Array<{ ref: string; dest: string }> };
  assert.equal(eff.mounts.length, 1);
  assert.equal(eff.mounts[0]!.ref, 'sample/shared-lib');
  assert.equal(meta.primaryRepo, 'sample/shared-lib');
});

test('buildBoardSessionMetadata pins platform skills and grants the skills capability', async () => {
  const projects = new ProjectConfigRegistry([{
    projectId: 'p1',
    tenantId: 't1',
    repos: [{ slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' }],
  }]);
  const assetsRoot = path.resolve(here, '../../../..');
  const loader = new AgentConfigLoader({ serviceDefaultRoot: assetsRoot });
  const catalog: CatalogSkill[] = [{
    metadata: {
      id: 'repo-orientation',
      folder: 'repo-orientation',
      version: '1.0.0',
      description: 'Orient in a repo',
      riskClass: 'shell',
      tags: ['coding'],
      engines: ['pi-agent'],
      toolDeps: [],
      requiredCapabilities: ['shell'],
      entry: 'SKILL.md',
      pinned: true,
    },
    contentHash: 'sha256:orient',
    source: 'platform',
    contentRef: '/tmp/platform-skills/repo-orientation',
    tree: { folder: 'repo-orientation', files: [{ path: 'SKILL.md', content: '# x' }] },
  }];
  const task = {
    id: 'task-1',
    tenantId: 't1',
    projectId: 'p1',
    title: 'Fix bug',
    body: 'details',
    status: 'backlog' as const,
    priority: 'medium' as const,
    assigneeKind: 'agent' as const,
    assigneeId: 'agent-coder',
    createdBy: 'u1',
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const meta = await buildBoardSessionMetadata(
    {
      projects,
      configLoader: loader,
      defaultRepoSlug: 'sample/service',
      skillCatalog: async () => catalog,
    },
    task,
    { kind: 'worker', agentSpecId: 'coder' },
  );
  const eff = meta.effectiveScope as { capabilities: string[]; skills: string[] };
  assert.deepEqual(eff.skills, ['repo-orientation']);
  assert.ok(eff.capabilities.includes('skills'));
  assert.ok(eff.capabilities.includes('shell'));
  const pinned = meta.resolvedSkills as Array<{ id: string; contentHash: string }>;
  assert.equal(pinned[0]?.id, 'repo-orientation');
  assert.equal(pinned[0]?.contentHash, 'sha256:orient');
});

test('buildBoardSessionMetadata pins author skills and mounts no repos', async () => {
  const projects = new ProjectConfigRegistry([{
    projectId: 'p1',
    tenantId: 't1',
    repos: [{ slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' }],
  }]);
  const assetsRoot = path.resolve(here, '../../../..');
  const loader = new AgentConfigLoader({ serviceDefaultRoot: assetsRoot });
  const catalog: CatalogSkill[] = ['business-paper', 'chart', 'repo-orientation'].map((id) => ({
    metadata: {
      id,
      folder: id,
      version: '1.0.0',
      description: id,
      riskClass: 'readonly',
      tags: [],
      engines: ['pi-agent'],
      toolDeps: [],
      requiredCapabilities: [],
      entry: 'SKILL.md',
      pinned: true,
    },
    contentHash: `sha256:${id}`,
    source: 'platform',
    contentRef: `/tmp/skills/${id}`,
    tree: { folder: id, files: [{ path: 'SKILL.md', content: '# x' }] },
  }));
  const task = {
    id: 'task-author',
    tenantId: 't1',
    projectId: 'p1',
    title: 'Write a short paper',
    body: 'Research topic X',
    status: 'backlog' as const,
    priority: 'medium' as const,
    assigneeKind: 'agent' as const,
    assigneeId: 'agent-author',
    createdBy: 'u1',
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const meta = await buildBoardSessionMetadata(
    {
      projects,
      configLoader: loader,
      defaultRepoSlug: 'sample/service',
      skillCatalog: async () => catalog,
    },
    task,
    { kind: 'worker', agentSpecId: 'author' },
  );
  const eff = meta.effectiveScope as { capabilities: string[]; skills: string[]; mounts: unknown[] };
  assert.deepEqual(eff.skills, ['business-paper', 'chart']);
  assert.ok(eff.capabilities.includes('skills'));
  assert.equal(eff.mounts.length, 0);
});

test('buildBoardSessionMetadata does not grant skills when the catalog is empty', async () => {
  const projects = new ProjectConfigRegistry([{
    projectId: 'p1',
    tenantId: 't1',
    repos: [{ slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' }],
  }]);
  const assetsRoot = path.resolve(here, '../../../..');
  const loader = new AgentConfigLoader({ serviceDefaultRoot: assetsRoot });
  const task = {
    id: 'task-1',
    tenantId: 't1',
    projectId: 'p1',
    title: 'Fix bug',
    body: 'details',
    status: 'backlog' as const,
    priority: 'medium' as const,
    assigneeKind: 'agent' as const,
    assigneeId: 'agent-coder',
    createdBy: 'u1',
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const meta = await buildBoardSessionMetadata(
    {
      projects,
      configLoader: loader,
      defaultRepoSlug: 'sample/service',
      skillCatalog: async () => [],
    },
    task,
    { kind: 'worker', agentSpecId: 'coder' },
  );
  const eff = meta.effectiveScope as { capabilities: string[]; skills: string[] };
  assert.deepEqual(eff.skills, []);
  assert.equal(eff.capabilities.includes('skills'), false);
});

test('buildBoardSessionMetadata mounts sample/service when the task selects it and the coder profile allows it', async () => {
  const projects = new ProjectConfigRegistry([{
    projectId: 'sample/service',
    tenantId: 'default',
    defaultRepos: ['sample/service'],
    repos: [
      { slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' },
    ],
  }]);
  const assetsRoot = path.resolve(here, '../../../..');
  const loader = new AgentConfigLoader({ serviceDefaultRoot: assetsRoot });
  const task = {
    id: 'task-sample',
    tenantId: 'default',
    projectId: 'sample/service',
    title: 'Sample e2e',
    body: 'tiny edit',
    status: 'backlog' as const,
    priority: 'medium' as const,
    assigneeKind: 'agent' as const,
    assigneeId: 'agent-coder',
    createdBy: 'u1',
    metadata: { repos: ['sample/service'], primaryRepo: 'sample/service' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const meta = await buildBoardSessionMetadata(
    { projects, configLoader: loader, defaultRepoSlug: 'sample/service' },
    task,
    { kind: 'worker', agentSpecId: 'coder' },
  );
  const eff = meta.effectiveScope as { mounts: Array<{ ref: string; dest: string }> };
  assert.equal(eff.mounts.length, 1);
  assert.equal(eff.mounts[0]!.ref, 'sample/service');
  assert.equal(meta.primaryRepo, 'sample/service');
});
