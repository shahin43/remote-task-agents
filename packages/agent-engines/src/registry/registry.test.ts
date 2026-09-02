import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentEngineRegistry } from './registry.js';
import type { AgentEngine, AgentSpec } from '@remote-sandbox-agents/contracts';

const fakeEngine = (kind: string): AgentEngine => ({
  kind,
  runTurn: async () => ({ toolCalls: [], finishReason: 'completed' }),
});

const specWith = (kind: string) => ({ engine: { kind } } as unknown as AgentSpec);

test('AgentEngineRegistry.create returns the engine registered for spec.engine.kind', () => {
  const registry = new AgentEngineRegistry()
    .register('pi-agent', () => fakeEngine('pi-agent'))
    .register('other-engine', () => fakeEngine('other-engine'));
  assert.equal(registry.create(specWith('pi-agent')).kind, 'pi-agent');
  assert.equal(registry.create(specWith('other-engine')).kind, 'other-engine');
});

test('AgentEngineRegistry.create throws a clear error for an unknown kind', () => {
  const registry = new AgentEngineRegistry().register('pi-agent', () =>
    fakeEngine('pi-agent'),
  );
  assert.throws(() => registry.create(specWith('nope')), /no engine registered for kind: nope/);
});

test('AgentEngineRegistry.has reports whether a kind is registered', () => {
  const registry = new AgentEngineRegistry().register('pi-agent', () =>
    fakeEngine('pi-agent'),
  );
  assert.equal(registry.has('pi-agent'), true);
  assert.equal(registry.has('other-engine'), false);
});

test('AgentEngineRegistry passes the build context through to the factory', () => {
  const registry = new AgentEngineRegistry<{ token: string }>().register(
    'pi-agent',
    (_spec, ctx) => fakeEngine(`pi:${ctx.token}`),
  );
  assert.equal(registry.create(specWith('pi-agent'), { token: 'abc' }).kind, 'pi:abc');
});
