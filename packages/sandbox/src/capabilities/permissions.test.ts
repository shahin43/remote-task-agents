import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsCapability } from './permissions.js';

describe('PermissionsCapability', () => {
  it('projects to engine config (sandbox mode, writable roots)', () => {
    const perms = new PermissionsCapability({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      writableRoots: ['repo'],
      deniedPaths: ['**/.env'],
      egressAllowlist: [],
    });
    const cfg = perms.toEngineConfig();
    assert.equal(cfg.sandbox, 'workspace-write');
    assert.equal(cfg.approvalPolicy, 'never');
    assert.deepEqual(cfg.writableRoots, ['repo']);
  });

  it('isPathDenied matches denylist globs', () => {
    const perms = new PermissionsCapability({
      sandboxMode: 'read-only', approvalPolicy: 'never',
      writableRoots: [], deniedPaths: ['**/.env', 'infra/**'], egressAllowlist: [],
    });
    assert.equal(perms.isPathDenied('repo/.env'), true);
    assert.equal(perms.isPathDenied('infra/main.tf'), true);
    assert.equal(perms.isPathDenied('repo/src/index.ts'), false);
  });

  it('isEgressAllowed honors the allowlist (empty = deny all)', () => {
    const deny = new PermissionsCapability({ sandboxMode: 'read-only', approvalPolicy: 'never', writableRoots: [], deniedPaths: [], egressAllowlist: [] });
    assert.equal(deny.isEgressAllowed('example.com'), false);
    const allow = new PermissionsCapability({ sandboxMode: 'read-only', approvalPolicy: 'never', writableRoots: [], deniedPaths: [], egressAllowlist: ['example.com'] });
    assert.equal(allow.isEgressAllowed('example.com'), true);
    assert.equal(allow.isEgressAllowed('evil.com'), false);
  });
});
