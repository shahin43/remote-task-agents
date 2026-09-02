import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkerProfile, PromptContract, ProfileDecision } from '../index.js';

test('WorkerProfile survives JSON round-trip', () => {
  const profile: WorkerProfile = {
    id: 'coding',
    runtime: 'local',
    engine: 'pi-agent',
    modelDefaults: {
      model: 'gpt-5.4',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
    },
    toolsets: ['filesystem', 'shell', 'git', 'provider-linear', 'provider-git'],
    skills: { mode: 'tagged', tags: ['coding'] },
    approvalPolicy: 'workspace-allowlist',
    limits: { maxRuntimeMinutes: 15, maxToolCalls: 50 },
    workspaceRetention: 'retain-for-inspection',
  };

  const serialized = JSON.stringify(profile);
  const deserialized: WorkerProfile = JSON.parse(serialized);

  assert.deepEqual(deserialized, profile);
  assert.equal(deserialized.id, 'coding');
  assert.equal(deserialized.runtime, 'local');
});

test('WorkerProfile triage has read-only sandbox', () => {
  const profile: WorkerProfile = {
    id: 'triage',
    runtime: 'local',
    engine: 'pi-agent',
    modelDefaults: {
      model: 'gpt-5.4',
      sandbox: 'read-only',
      approvalPolicy: 'never',
    },
    toolsets: ['filesystem-read', 'git-read'],
    skills: { mode: 'tagged', tags: ['triage'] },
    approvalPolicy: 'decline-all',
    limits: { maxRuntimeMinutes: 10, maxToolCalls: 25 },
    workspaceRetention: 'delete-on-success',
  };

  assert.equal(profile.modelDefaults.sandbox, 'read-only');
  assert.equal(profile.approvalPolicy, 'decline-all');
});

test('PromptContract has deterministic hash field', () => {
  const contract: PromptContract = {
    system: 'You are a coding agent. Follow the task instructions.',
    cacheBreakpoints: [64, 128],
    hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };

  const serialized = JSON.stringify(contract);
  const deserialized: PromptContract = JSON.parse(serialized);

  assert.deepEqual(deserialized, contract);
  assert.ok(deserialized.hash.startsWith('sha256:'));
});

test('ProfileDecision survives JSON round-trip', () => {
  const decision: ProfileDecision = {
    profileId: 'coding',
    reason: 'intent is implement',
    confidence: 1.0,
  };

  const serialized = JSON.stringify(decision);
  const deserialized: ProfileDecision = JSON.parse(serialized);

  assert.deepEqual(deserialized, decision);
});
