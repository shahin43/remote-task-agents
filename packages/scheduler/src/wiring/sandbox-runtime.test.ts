import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkerProfile } from '@remote-sandbox-agents/contracts';
import {
  resolveProviderOptions,
  routeSandboxEngine,
  isSandboxRuntime,
  applyRuntimeOverride,
  SANDBOX_ENGINE_RUNTIMES,
} from './sandbox-runtime.js';

function profile(runtime: WorkerProfile['runtime']): WorkerProfile {
  return {
    id: 'p', runtime, engine: 'pi-agent',
    modelDefaults: { model: 'gpt-5', sandbox: 'workspace-write', approvalPolicy: 'never' },
    toolsets: [], skills: { mode: 'all' }, approvalPolicy: 'never',
    limits: { maxRuntimeMinutes: 30, maxToolCalls: 200 }, workspaceRetention: 'delete-on-success',
  };
}

test('isSandboxRuntime is true only for sandbox-* runtimes', () => {
  assert.equal(isSandboxRuntime(profile('sandbox-unix-local')), true);
  assert.equal(isSandboxRuntime(profile('sandbox-docker')), true);
  assert.equal(isSandboxRuntime(profile('local')), false);
});

test('SANDBOX_ENGINE_RUNTIMES lists docker and unix-local', () => {
  assert.deepEqual([...SANDBOX_ENGINE_RUNTIMES].sort(), [
    'sandbox-docker',
    'sandbox-unix-local',
  ]);
});

test('sandbox-unix-local maps to provider type unix_local', () => {
  assert.deepEqual(resolveProviderOptions(profile('sandbox-unix-local')), { type: 'unix_local' });
});

test('sandbox-docker maps to provider type docker', () => {
  assert.equal(routeSandboxEngine(profile('sandbox-docker')).type, 'docker');
});

test('applyRuntimeOverride flips docker to unix-local', () => {
  assert.equal(
    applyRuntimeOverride(profile('sandbox-docker'), 'sandbox-unix-local').runtime,
    'sandbox-unix-local',
  );
});

test('a non-sandbox runtime throws', () => {
  assert.throws(() => resolveProviderOptions(profile('local')), /not a sandbox runtime/);
});
