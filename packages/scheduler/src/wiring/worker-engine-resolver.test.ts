import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { AgentSpec } from '@remote-sandbox-agents/contracts';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';
import { makeWorkerEngineResolver } from './worker-engine-resolver.js';
import { PiRunnerEngineAdapter } from './pi-runner-engine-adapter.js';

const deps = {
  workerEnv: {},
  piProvider: 'openai',
  piModel: 'gpt-5.4-mini',
  piRunnerBundlePath: '/host/pi-runner.bundle.cjs',
  piRunnerEnv: {},
};

const specWithEngine = (kind: string) => ({ actor: 'worker', engine: { kind } } as unknown as AgentSpec);

function fakeSandboxSession(): SandboxSession {
  return {
    state: { type: 'docker', sessionId: 's1', workspaceRoot: '/workspace' },
    start: async () => {},
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    read: async () => Readable.from(['']),
    write: async () => {},
    persistWorkspace: async () => Readable.from(['']),
    stop: async () => {},
  };
}

test('resolves pi-agent worker specs to the host-side pi engine when no sandbox session', () => {
  const resolve = makeWorkerEngineResolver(deps);
  const engine = resolve(specWithEngine('pi-agent'));
  assert.equal(engine.kind, 'pi-agent');
  assert.ok(!(engine instanceof PiRunnerEngineAdapter), 'expected host-side engine without a sandbox');
});

test('resolves pi-agent to the in-container PiRunnerEngineAdapter when a sandbox session is present', () => {
  const resolve = makeWorkerEngineResolver(deps);
  const engine = resolve(specWithEngine('pi-agent'), fakeSandboxSession());
  assert.equal(engine.kind, 'pi-agent');
  assert.ok(engine instanceof PiRunnerEngineAdapter, 'expected in-container adapter');
});

test('throws for an unknown worker engine kind', () => {
  const resolve = makeWorkerEngineResolver(deps);
  assert.throws(() => resolve(specWithEngine('bogus')), /no engine registered for kind: bogus/);
});
