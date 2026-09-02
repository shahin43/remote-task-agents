import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolDescriptor, ToolHandler, ToolInvocationContext } from '@remote-sandbox-agents/contracts';
import { ScopedToolRegistry } from './scoped-tool-registry.js';

function fakeHandler(name: string): ToolHandler {
  return {
    name,
    async invoke(args: unknown, _ctx: ToolInvocationContext) {
      return { success: true, output: `${name}:${JSON.stringify(args)}` };
    },
  };
}

test('list filters by scope', () => {
  const r = new ScopedToolRegistry();
  const dispatch: ToolDescriptor = { name: 'dispatch_job', toolset: 'core', schema: {} };
  const engineTool: ToolDescriptor = { name: 'shell.run', toolset: 'shell', schema: {} };
  r.register('orchestrator', dispatch, fakeHandler('dispatch_job'));
  r.register('worker', engineTool, fakeHandler('shell.run'));
  assert.deepEqual(r.list('orchestrator').map((d) => d.name), ['dispatch_job']);
  assert.deepEqual(r.list('worker').map((d) => d.name), ['shell.run']);
});

test('invoke uses the registered handler', async () => {
  const r = new ScopedToolRegistry();
  r.register('orchestrator', { name: 'dispatch_job', toolset: 'core', schema: {} }, fakeHandler('dispatch_job'));
  const result = await r.invoke('dispatch_job', { goal: 'x' }, {
    runId: 'r', profileId: 'p', workspacePath: '/tmp',
  });
  assert.equal(result.success, true);
  assert.match(result.output, /dispatch_job/);
});

test('invoke errors on unknown tool', async () => {
  const r = new ScopedToolRegistry();
  await assert.rejects(
    r.invoke('missing', {}, { runId: 'r', profileId: 'p', workspacePath: '/tmp' }),
    /unknown tool/i,
  );
});

test('register rejects duplicate within same scope', () => {
  const r = new ScopedToolRegistry();
  r.register('orchestrator', { name: 'x', toolset: 't', schema: {} }, fakeHandler('x'));
  assert.throws(
    () => r.register('orchestrator', { name: 'x', toolset: 't', schema: {} }, fakeHandler('x')),
    /already registered/i,
  );
});
