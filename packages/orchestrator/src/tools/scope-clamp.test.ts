import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScopePolicy, ScopeRequest } from '@remote-sandbox-agents/contracts';
import { clampScope, ScopeDeniedError } from './scope-clamp.js';

const policy: ScopePolicy = {
  allowedRepos: ['sample/service'],
  allowedMountTypes: ['git'],
  pathDenylist: ['**/.env', 'infra/**'],
  maxMountedPaths: 5,
};

test('passes a request fully within policy unchanged', () => {
  const req: ScopeRequest = {
    targetPaths: ['src/auth', 'src/api'],
    mounts: [{ kind: 'git', ref: 'sample/service', dest: 'repo', at: 'main' }],
  };
  const eff = clampScope(req, policy);
  assert.deepEqual(eff.targetPaths, ['src/auth', 'src/api']);
  assert.equal(eff.mounts.length, 1);
  assert.equal(eff.mounts[0].ref, 'sample/service');
});

test('rejects a mount whose repo is not in allowedRepos', () => {
  const req: ScopeRequest = { mounts: [{ kind: 'git', ref: 'evil/repo', dest: 'repo', at: 'main' }] };
  assert.throws(() => clampScope(req, policy), ScopeDeniedError);
});

test('rejects a mount kind not in allowedMountTypes', () => {
  const req: ScopeRequest = { mounts: [{ kind: 's3', ref: 'sample/service', dest: 'data', at: 'p/' }] };
  assert.throws(() => clampScope(req, policy), /mount kind/);
});

test('rejects a target path that matches the denylist', () => {
  const req: ScopeRequest = { targetPaths: ['infra/main.tf'] };
  assert.throws(() => clampScope(req, policy), /denied/);
});

test('rejects when targetPaths exceed maxMountedPaths', () => {
  const req: ScopeRequest = { targetPaths: ['a', 'b', 'c', 'd', 'e', 'f'] };
  assert.throws(() => clampScope(req, policy), /maxMountedPaths/);
});

test('empty request yields empty effective scope (profile default applies later)', () => {
  const eff = clampScope({}, policy);
  assert.deepEqual(eff.targetPaths, []);
  assert.deepEqual(eff.mounts, []);
});
