import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SandboxError, MountConfigError, NotImplementedError } from './errors.js';
import { execOk } from './types.js';

describe('errors', () => {
  it('SandboxError carries code and context', () => {
    const e = new SandboxError('x', 'boom', { a: 1 });
    assert.equal(e.code, 'x');
    assert.equal(e.message, 'boom');
    assert.deepEqual(e.context, { a: 1 });
    assert.equal(e.name, 'SandboxError');
  });

  it('MountConfigError sets code=mount_config and name', () => {
    const e = new MountConfigError('bad', { type: 'git' });
    assert.equal(e.code, 'mount_config');
    assert.equal(e.name, 'MountConfigError');
    assert.ok(e instanceof SandboxError);
  });

  it('NotImplementedError sets code=not_implemented', () => {
    const e = new NotImplementedError('later');
    assert.equal(e.code, 'not_implemented');
  });
});

describe('execOk', () => {
  it('true on exit 0, false otherwise', () => {
    assert.equal(execOk({ exitCode: 0, stdout: '', stderr: '' }), true);
    assert.equal(execOk({ exitCode: 1, stdout: '', stderr: '' }), false);
  });
});
