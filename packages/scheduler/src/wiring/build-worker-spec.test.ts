import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedAgentConfig } from '@remote-sandbox-agents/orchestrator';
import { buildWorkerSpec } from './build-worker-spec.js';

const cfg: ResolvedAgentConfig = {
  id: 'coding-default',
  soul: 'You are a focused coding worker.',
  basePrompt: 'Make the requested change and run the tests.',
  profile: {
    id: 'coding-default', actor: 'worker', runtime: 'sandbox-unix-local', engine: 'pi-agent',
    model: { id: 'gpt-5', sandbox: 'workspace-write', approvalPolicy: 'never' },
    toolsets: ['shell'], skills: { mode: 'all' },
    policies: { approvalPolicy: 'never', maxTurns: 1, turnTimeoutMs: 1_800_000, maxToolCalls: 200, maxRuntimeMinutes: 30 },
    workspaceRetention: 'delete-on-success',
  },
  sources: { soul: 'service-default', basePrompt: 'service-default', profile: 'service-default' },
};

const fakeSession = { session: { id: 's1' }, history: [] } as never;

test('workspace.prepare returns the injected session root (cwd binding)', async () => {
  const spec = buildWorkerSpec(cfg, '/sandboxes/s1/workspace');
  const handle = await spec.workspace.prepare(spec, fakeSession);
  assert.equal(handle.path, '/sandboxes/s1/workspace');
  assert.equal(spec.workspace.kind, 'local');
});

test('engine ref is pi-agent and carries the model', async () => {
  const spec = buildWorkerSpec(cfg, '/ws');
  assert.equal(spec.engine.kind, 'pi-agent');
  assert.equal((spec.engine.options as { model?: string }).model, 'gpt-5');
});

test('system prompt concatenates soul + basePrompt', async () => {
  const spec = buildWorkerSpec(cfg, '/ws');
  const contract = await spec.prompt.assemble(fakeSession);
  assert.match(contract.system, /focused coding worker/);
  assert.match(contract.system, /run the tests/);
});

test('fs mode and policies derive from the profile', async () => {
  const spec = buildWorkerSpec(cfg, '/ws');
  assert.equal(spec.fs.mode, 'scoped');
  assert.equal(spec.fs.root, '/ws');
  assert.equal(spec.policies.maxRuntimeMinutes, 30);
  assert.equal(spec.policies.approvalPolicy, 'never');
});

test('engine kind follows the profile (pi profile -> pi-agent) and tools are injected', async () => {
  const piCfg: ResolvedAgentConfig = {
    ...cfg,
    profile: { ...cfg.profile, engine: 'pi-agent' },
  };
  const tools = { list: () => [{ name: 'shell', toolset: 'sandbox', schema: {} }], invoke: async () => ({ success: true, output: '' }) };
  const spec = buildWorkerSpec(piCfg, '/ws', tools);
  assert.equal(spec.engine.kind, 'pi-agent');
  assert.equal(spec.tools.list('worker').length, 1);
  assert.equal(spec.tools.list('worker')[0]?.name, 'shell');
});

test('tools default to an empty provider when omitted', async () => {
  const spec = buildWorkerSpec(cfg, '/ws');
  assert.deepEqual(spec.tools.list('worker'), []);
});
