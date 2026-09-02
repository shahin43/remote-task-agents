import assert from 'node:assert/strict';
import test from 'node:test';
import type { HandoffEnvelope, ApprovalRequest, WorkspaceSpec } from '../index.js';

test('HandoffEnvelope survives JSON round-trip', () => {
  const envelope: HandoffEnvelope = {
    run: {
      runId: 'ENG-123-attempt-1',
      attempt: 1,
      leaseExpiresAt: '2026-05-17T10:15:00.000Z',
      taskKey: 'task-001',
    },
    profile: {
      id: 'coding',
      runtime: 'local',
      engine: 'pi-agent',
      modelDefaults: { model: 'gpt-5.4', sandbox: 'workspace-write', approvalPolicy: 'on-request' },
      toolsets: ['filesystem', 'shell'],
      skills: { mode: 'all' },
      approvalPolicy: 'workspace-allowlist',
      limits: { maxRuntimeMinutes: 15, maxToolCalls: 50 },
      workspaceRetention: 'retain-for-inspection',
    },
    promptContract: {
      system: 'You are a coding agent...',
      cacheBreakpoints: [128],
      hash: 'sha256:abc123',
    },
    toolset: [{ name: 'read_skill', toolset: 'skills', schema: { type: 'object' } }],
    skills: [{ name: 'deploy-staging', source: 'repo', description: 'Push to staging', tags: ['coding'], enabled: true }],
    workspace: {
      source: '/repos/sample-service',
      targetPaths: ['src/'],
      gitPolicy: 'exclude',
      mountType: 'local-copy',
    },
    secrets: [{ id: 'openai', ref: 'env:OPENAI_API_KEY', consumedBy: 'engine' }],
    env: { REMOTE_AGENT_NETWORK_PROFILE: 'off' },
    events: { kind: 'stdio-jsonl' },
  };

  const serialized = JSON.stringify(envelope);
  const deserialized: HandoffEnvelope = JSON.parse(serialized);

  assert.deepEqual(deserialized, envelope);
  assert.equal(deserialized.secrets[0].ref, 'env:OPENAI_API_KEY');
  assert.equal(typeof deserialized.promptContract.hash, 'string');
});

test('HandoffEnvelope secrets carry refs not values', () => {
  const envelope: HandoffEnvelope = {
    run: { runId: 'r1', attempt: 1, leaseExpiresAt: '', taskKey: 'k1' },
    profile: {
      id: 'triage', runtime: 'local', engine: 'pi-agent',
      modelDefaults: { model: 'm', sandbox: 's', approvalPolicy: 'p' },
      toolsets: [], skills: { mode: 'all' }, approvalPolicy: 'a',
      limits: { maxRuntimeMinutes: 5, maxToolCalls: 10 },
      workspaceRetention: 'delete-on-success',
    },
    promptContract: { system: '', cacheBreakpoints: [], hash: '' },
    toolset: [],
    skills: [],
    workspace: { source: '/tmp', targetPaths: [], gitPolicy: 'exclude', mountType: 'local-copy' },
    secrets: [{ id: 'openai', ref: 'env:OPENAI_API_KEY', consumedBy: 'engine' }],
    env: {},
    events: { kind: 'stdio-jsonl' },
  };

  for (const secret of envelope.secrets) {
    assert.ok(
      secret.ref.startsWith('env:') || secret.ref.startsWith('vault:') || secret.ref.startsWith('file:'),
      `Secret ref "${secret.ref}" must use a known scheme`
    );
    assert.equal('value' in secret, false, 'Secret must not carry a plaintext value field');
  }
});

test('WorkspaceSpec survives JSON round-trip', () => {
  const spec: WorkspaceSpec = {
    source: '/repos/sample-service',
    targetPaths: ['src/', 'lib/'],
    gitPolicy: 'preserve',
    mountType: 'volume-mount',
  };

  const serialized = JSON.stringify(spec);
  const deserialized: WorkspaceSpec = JSON.parse(serialized);
  assert.deepEqual(deserialized, spec);
});

test('ApprovalRequest survives JSON round-trip', () => {
  const request: ApprovalRequest = {
    toolName: 'shell',
    command: ['npm', 'run', 'build'],
    cwd: '/workspace/repo',
  };

  const serialized = JSON.stringify(request);
  const deserialized: ApprovalRequest = JSON.parse(serialized);
  assert.deepEqual(deserialized, request);
});
