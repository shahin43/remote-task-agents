import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AgentConfigLoader, toWorkerProfile } from './agent-config-loader.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-cfg-'));
  const serviceDefaults = path.join(root, 'service');
  const repoOverride = path.join(root, 'repo');
  await mkdir(path.join(serviceDefaults, 'agents', 'coding-default'), { recursive: true });
  await writeFile(path.join(serviceDefaults, 'agents', 'coding-default', 'SOUL.md'), '# default coding SOUL', 'utf8');
  await writeFile(path.join(serviceDefaults, 'agents', 'coding-default', 'base-prompt.md'), 'default base', 'utf8');
  await writeFile(path.join(serviceDefaults, 'agents', 'coding-default', 'profile.yaml'),
    [
      'id: coding-default',
      'actor: worker',
      'runtime: local',
      'engine: pi-agent',
      'model:',
      '  id: gpt-5',
      '  sandbox: workspace-write',
      '  approvalPolicy: never',
      'toolsets: [shell]',
      'skills:',
      '  mode: all',
      'policies:',
      '  approvalPolicy: never',
      '  maxTurns: 1',
      '  turnTimeoutMs: 120000',
      '  maxToolCalls: 200',
      '  maxRuntimeMinutes: 30',
      'workspaceRetention: delete-on-success',
      'scopePolicy:',
      '  allowedRepos:',
      '    - sample/service',
      '  allowedMountTypes:',
      '    - git',
      '  pathDenylist:',
      '    - "**/.env"',
      '  maxMountedPaths: 50',
    ].join('\n'),
    'utf8',
  );
  return { root, serviceDefaults, repoOverride };
}

test('loads service defaults when no overrides exist', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const cfg = await loader.resolve('coding-default');
  assert.equal(cfg.soul, '# default coding SOUL');
  assert.equal(cfg.basePrompt, 'default base');
  assert.equal(cfg.profile.id, 'coding-default');
  assert.equal(cfg.profile.actor, 'worker');
  assert.equal(cfg.sources.soul, 'service-default');
  await rm(root, { recursive: true, force: true });
});

test('toWorkerProfile carries scopePolicy from profile.yaml', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const cfg = await loader.resolve('coding-default');
  const profile = toWorkerProfile(cfg.profile);
  assert.ok(profile.scopePolicy, 'scopePolicy present');
  assert.deepEqual(profile.scopePolicy?.allowedRepos, ['sample/service']);
  assert.deepEqual(profile.scopePolicy?.allowedMountTypes, ['git']);
  assert.ok(profile.scopePolicy?.pathDenylist?.includes('**/.env'));
  assert.equal(profile.scopePolicy?.maxMountedPaths, 50);
  await rm(root, { recursive: true, force: true });
});

test('toWorkerProfile accepts a worker profile whose engine is pi-agent', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  await writeFile(path.join(serviceDefaults, 'agents', 'coding-default', 'profile.yaml'),
    [
      'id: coding-default',
      'actor: worker',
      'runtime: sandbox-docker',
      'engine: pi-agent',
      'model:',
      '  id: gpt-5',
      '  sandbox: workspace-write',
      '  approvalPolicy: never',
      'toolsets: [board]',
      'skills:',
      '  mode: all',
      'policies:',
      '  approvalPolicy: never',
      '  maxTurns: 1',
      '  turnTimeoutMs: 120000',
      '  maxToolCalls: 200',
      '  maxRuntimeMinutes: 30',
      'workspaceRetention: delete-on-success',
    ].join('\n'),
    'utf8',
  );
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const cfg = await loader.resolve('coding-default');
  const profile = toWorkerProfile(cfg.profile);
  assert.equal(profile.engine, 'pi-agent');
  await rm(root, { recursive: true, force: true });
});

test('toWorkerProfile rejects an unknown worker engine kind', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  await writeFile(path.join(serviceDefaults, 'agents', 'coding-default', 'profile.yaml'),
    [
      'id: coding-default',
      'actor: worker',
      'runtime: local',
      'engine: bogus-engine',
      'model:',
      '  id: gpt-5',
      'toolsets: [shell]',
      'skills:',
      '  mode: all',
      'policies:',
      '  approvalPolicy: never',
      '  maxTurns: 1',
      '  turnTimeoutMs: 120000',
      '  maxToolCalls: 200',
      '  maxRuntimeMinutes: 30',
      'workspaceRetention: delete-on-success',
    ].join('\n'),
    'utf8',
  );
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const cfg = await loader.resolve('coding-default');
  assert.throws(() => toWorkerProfile(cfg.profile), /unknown worker engine 'bogus-engine'/);
  await rm(root, { recursive: true, force: true });
});

test('per-profile override wins over service default', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  await mkdir(path.join(repoOverride, '.remote-agent', 'agents', 'coding-default'), { recursive: true });
  await writeFile(
    path.join(repoOverride, '.remote-agent', 'agents', 'coding-default', 'SOUL.md'),
    '# repo override SOUL',
    'utf8',
  );
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const cfg = await loader.resolve('coding-default');
  assert.equal(cfg.soul, '# repo override SOUL');
  assert.equal(cfg.basePrompt, 'default base'); // not overridden
  assert.equal(cfg.sources.soul, 'repo-per-profile');
  assert.equal(cfg.sources.basePrompt, 'service-default');
  await rm(root, { recursive: true, force: true });
});

test('legacy .remote-agent/SOUL.md applies only when profile is a worker and no per-profile override exists', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  await mkdir(path.join(repoOverride, '.remote-agent'), { recursive: true });
  await writeFile(path.join(repoOverride, '.remote-agent', 'SOUL.md'), '# legacy global SOUL', 'utf8');
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const cfg = await loader.resolve('coding-default');
  assert.equal(cfg.soul, '# legacy global SOUL');
  assert.equal(cfg.sources.soul, 'repo-legacy');
  await rm(root, { recursive: true, force: true });
});

test('legacy .remote-agent/SOUL.md does NOT apply to orchestrator profiles', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  await mkdir(path.join(serviceDefaults, 'agents', 'orchestrator-supervisor'), { recursive: true });
  await writeFile(path.join(serviceDefaults, 'agents', 'orchestrator-supervisor', 'SOUL.md'), '# default orch SOUL', 'utf8');
  await writeFile(path.join(serviceDefaults, 'agents', 'orchestrator-supervisor', 'base-prompt.md'), 'orch base', 'utf8');
  await writeFile(path.join(serviceDefaults, 'agents', 'orchestrator-supervisor', 'profile.yaml'),
    [
      'id: orchestrator-supervisor',
      'actor: orchestrator',
      'engine: pi-agent',
      'model:',
      '  id: claude-opus-4-5',
      '  provider: anthropic',
      'policies:',
      '  approvalPolicy: never',
      '  maxTurns: 1',
      '  turnTimeoutMs: 120000',
      '  maxToolCalls: 8',
      '  maxRuntimeMinutes: 5',
    ].join('\n'),
    'utf8',
  );
  await mkdir(path.join(repoOverride, '.remote-agent'), { recursive: true });
  await writeFile(path.join(repoOverride, '.remote-agent', 'SOUL.md'), '# legacy worker SOUL', 'utf8');
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const cfg = await loader.resolve('orchestrator-supervisor');
  assert.equal(cfg.soul, '# default orch SOUL');
  assert.equal(cfg.sources.soul, 'service-default');
  await rm(root, { recursive: true, force: true });
});

test('list returns every profile id present in service defaults', async () => {
  const { root, serviceDefaults, repoOverride } = await fixture();
  await mkdir(path.join(serviceDefaults, 'agents', 'triage-default'), { recursive: true });
  await writeFile(path.join(serviceDefaults, 'agents', 'triage-default', 'SOUL.md'), 'x', 'utf8');
  await writeFile(path.join(serviceDefaults, 'agents', 'triage-default', 'base-prompt.md'), 'x', 'utf8');
  await writeFile(path.join(serviceDefaults, 'agents', 'triage-default', 'profile.yaml'),
    [
      'id: triage-default',
      'actor: worker',
      'runtime: local',
      'engine: pi-agent',
      'model:',
      '  id: gpt-5',
      '  sandbox: read-only',
      '  approvalPolicy: never',
      'toolsets: [shell]',
      'skills:',
      '  mode: tagged',
      '  tags: [triage]',
      'policies:',
      '  approvalPolicy: never',
      '  maxTurns: 1',
      '  turnTimeoutMs: 60000',
      '  maxToolCalls: 50',
      '  maxRuntimeMinutes: 5',
      'workspaceRetention: delete-on-success',
    ].join('\n'),
    'utf8',
  );
  const loader = new AgentConfigLoader({ serviceDefaultRoot: serviceDefaults, repoOverrideRoot: repoOverride });
  const ids = (await loader.list()).map((p) => p.id).sort();
  assert.deepEqual(ids, ['coding-default', 'triage-default']);
  await rm(root, { recursive: true, force: true });
});
