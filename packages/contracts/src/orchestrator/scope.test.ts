import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScopePolicy, ScopeRequest, MountRequest, EffectiveScope } from './scope.js';

test('ScopePolicy/ScopeRequest/MountRequest are structurally usable', () => {
  const policy: ScopePolicy = {
    allowedRepos: ['sample/service'],
    allowedMountTypes: ['git'],
    pathDenylist: ['**/.env'],
  };
  const req: ScopeRequest = { targetPaths: ['src/auth'], mounts: [{ kind: 'git', ref: 'sample/service', dest: 'repo', at: 'main' }] };
  const eff: EffectiveScope = { targetPaths: req.targetPaths!, mounts: req.mounts! };
  assert.equal(policy.allowedRepos[0], 'sample/service');
  assert.equal(eff.mounts[0].dest, 'repo');
  const m: MountRequest = { kind: 's3', ref: 'my-bucket', dest: 'data', at: 'prefix/', readOnly: true };
  assert.equal(m.readOnly, true);
});
