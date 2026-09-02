import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = [
  'SandboxManager',
  'DockerSandboxProvider',
  'DockerSandboxProvider',
  'UnixLocalSandboxProvider',
  'reapOrphanContainers',
  'WorkerScheduler',
  'wireWorkerRuntime',
];

function sourceOf(name: string): string {
  return fs.readFileSync(path.join(here, name.replace(/\.ts$/, '.js')), 'utf8');
}

test('API runtime source does not import sandbox execution machinery', () => {
  const src = sourceOf('api-runtime.ts');
  for (const token of FORBIDDEN) {
    assert.equal(src.includes(token), false, `api-runtime.ts must not mention ${token}`);
  }
});

test('control runtime source does not import sandbox execution machinery', () => {
  const src = sourceOf('control-runtime.ts');
  for (const token of FORBIDDEN) {
    assert.equal(src.includes(token), false, `control-runtime.ts must not mention ${token}`);
  }
});

test('shared persistence source does not import sandbox execution machinery', () => {
  const src = sourceOf('shared-persistence.ts');
  for (const token of ['SandboxManager', 'DockerSandboxProvider', 'DockerSandboxProvider', 'reapOrphanContainers']) {
    assert.equal(src.includes(token), false, `shared-persistence.ts must not mention ${token}`);
  }
});

test('worker runtime does not import host git MR promotion (host API owns the token)', () => {
  const worker = fs.readFileSync(path.join(here, '..', 'wiring', 'worker-runtime.js'), 'utf8');
  assert.equal(worker.includes('git-artifact-promotion'), false);
  assert.equal(worker.includes('promoteMrRequest'), false);
});

test('control runtime captures MR intent but does not promote to host git', () => {
  const src = sourceOf('control-runtime.ts');
  assert.equal(src.includes('git-artifact-promotion'), false);
  assert.equal(src.includes('promoteMrRequest'), false);
  const projector = sourceOf('completion-projector.ts');
  assert.equal(projector.includes('captureMrRequest'), true);
  assert.equal(projector.includes('promoteMrRequest'), false);
});
