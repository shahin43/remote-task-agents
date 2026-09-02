import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkerProfile } from '@remote-sandbox-agents/contracts';
import { toAgentProfileView } from './agent-profile-view.js';

const profile = {
  id: 'reviewer',
  runtime: 'sandbox-docker',
  engine: 'pi-agent',
  modelDefaults: { model: 'gpt-5.4-mini', sandbox: 'workspace-write', approvalPolicy: 'never' },
  toolsets: [],
  skills: { mode: 'named' as const, names: [] },
  approvalPolicy: 'never',
  limits: { maxRuntimeMinutes: 30, maxToolCalls: 8 },
  workspaceRetention: 'delete-on-success',
  scopePolicy: { allowedRepos: ['sample/service'], allowedMountTypes: ['git'], maxMountedPaths: 3 },
} as WorkerProfile;

test('toAgentProfileView projects the resolved profile into a display view', () => {
  const view = toAgentProfileView(
    { id: 'agent-reviewer', displayName: 'Reviewer', profileId: 'reviewer' },
    profile,
  );
  assert.equal(view.profileId, 'reviewer');
  assert.equal(view.engine, 'pi-agent');
  assert.equal(view.runtime, 'sandbox-docker');
  assert.equal(view.model, 'gpt-5.4-mini');
  assert.equal(view.sandbox, 'workspace-write');
  assert.equal(view.approvalPolicy, 'never');
  assert.deepEqual(view.scope.allowedRepos, ['sample/service']);
  assert.equal(view.limits.maxRuntimeMinutes, 30);
  assert.equal(view.limits.maxToolCalls, 8);
  assert.equal(view.workspaceRetention, 'delete-on-success');
  assert.equal(view.configPath, 'agents/reviewer/profile.yaml');
  assert.equal(view.source, 'service-default');
});

test('toAgentProfileView extracts description from SOUL.md', () => {
  const soul = '# Pi reviewer worker SOUL\n\nYou are a pi-powered reviewer worker. You receive a single review job.\n\nNext paragraph.';
  const view = toAgentProfileView(
    { id: 'agent-reviewer', displayName: 'Reviewer', profileId: 'reviewer' },
    profile,
    { soul, source: 'service-default' },
  );
  assert.equal(
    view.description,
    'You are a pi-powered reviewer worker. You receive a single review job.',
  );
});

test('toAgentProfileView gracefully handles missing SOUL', () => {
  const view = toAgentProfileView(
    { id: 'agent-reviewer', displayName: 'Reviewer', profileId: 'reviewer' },
    profile,
  );
  assert.equal(view.description, null);
});
