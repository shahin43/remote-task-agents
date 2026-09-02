import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';
import { InMemorySessionEventsRepo, InMemoryAgentBus } from '@remote-sandbox-agents/persistence';
import type { AgentSpec, SessionRecord, SessionSnapshot } from '@remote-sandbox-agents/contracts';
import { PiRunnerEngineAdapter } from './pi-runner-engine-adapter.js';
import type { AgentRuntimeTemplate } from './agent-runtime-template.js';

function fakeSession(): SandboxSession {
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

function fakeTemplate(opts: {
  exitOk?: boolean;
  onMaterialize?: (ctx: { spec: { messages?: unknown[]; systemPrompt?: string }; scope: { skills: string[] } }) => void;
} = {}): { template: AgentRuntimeTemplate; materialized: boolean } {
  const ref = { materialized: false };
  const template: AgentRuntimeTemplate = {
    id: 'pi-runner',
    materialize: async (_session, ctx) => {
      ref.materialized = true;
      opts.onMaterialize?.(ctx);
    },
    launch: () => ({ command: 'node', args: ['/workspace/.agent/pi-runner.js', '/workspace'] }),
    collect: async () => ({
      summary: 'Implemented the change.',
      events: [{ type: 'tool_call', at: 'now', data: { name: 'write_file', callId: 'c1', args: {}, result: { success: true, output: 'ok' }, startedAt: 'a', endedAt: 'b' } }],
      usage: { inputTokens: 12, outputTokens: 4 },
      artifacts: { artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true }] },
    }),
  };
  return { template, materialized: ref.materialized } as never;
}

function spec(): AgentSpec {
  return {
    id: 'coding-default', actor: 'worker', engine: { kind: 'pi-agent' },
    prompt: { assemble: async () => ({ system: 'SYS', cacheBreakpoints: [], hash: '' }) },
    tools: { list: () => [], invoke: async () => ({ success: true, output: '' }) },
    skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' },
    workspace: { kind: 'none', prepare: async () => ({ cleanupHints: { retention: 'delete-on-success' }, metadata: {} }), cleanup: async () => {} },
    secrets: { resolve: async () => ({}) } as never,
    fs: { mode: 'scoped', root: '/workspace' },
    policies: { approvalPolicy: 'never', maxTurns: 5, turnTimeoutMs: 60_000, maxToolCalls: 8, maxRuntimeMinutes: 5 },
    metadata: {},
  };
}

function snapshot(): SessionSnapshot {
  const session: SessionRecord = {
    id: 'w1', actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin: 'board:v1:proj:task-1', agentSpecId: 'coding-default',
    openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
  };
  return {
    session,
    history: [{ sessionId: 'w1', eventIndex: 0, eventType: 'input', kind: 'channel.input', payload: { text: 'Add a feature' }, createdAt: new Date().toISOString() }],
  };
}

test('PiRunnerEngineAdapter materializes, execs, collects, and publishes events', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const { template } = fakeTemplate();
  const adapter = new PiRunnerEngineAdapter({
    sandboxSession: fakeSession(), template, bundlePath: '/host/pi-runner.cjs',
    provider: 'openai', model: 'gpt-5.4-mini', env: { OPENAI_API_KEY: 'sk-test' },
  });
  const result = await adapter.runTurn({ spec: spec(), session: snapshot(), bus, signal: new AbortController().signal });

  assert.equal(result.finishReason, 'completed');
  assert.equal(result.finalMessage, 'Implemented the change.');
  assert.equal(result.usage?.inputTokens, 12);
  assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.artifacts, { artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true }] });

  const events = [];
  for await (const e of bus.replay('w1')) events.push(e);
  assert.ok(events.some((e) => e.kind === 'tool_call.write_file'));
});

test('PiRunnerEngineAdapter returns error when the runner exits non-zero', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const session = { ...fakeSession(), exec: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }) };
  const { template } = fakeTemplate();
  const adapter = new PiRunnerEngineAdapter({
    sandboxSession: session, template, bundlePath: '/host/pi-runner.cjs',
    provider: 'openai', model: 'm', env: {},
  });
  const result = await adapter.runTurn({ spec: spec(), session: snapshot(), bus, signal: new AbortController().signal });
  assert.equal(result.finishReason, 'error');
  assert.match(result.errorMessage ?? '', /exited 1/);
});

test('PiRunnerEngineAdapter no-ops when there is no current input', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const { template } = fakeTemplate();
  const adapter = new PiRunnerEngineAdapter({
    sandboxSession: fakeSession(), template, bundlePath: '/host/pi-runner.cjs', provider: 'openai', model: 'm', env: {},
  });
  const snap = snapshot();
  snap.history = [];
  const result = await adapter.runTurn({ spec: spec(), session: snap, bus, signal: new AbortController().signal });
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.toolCalls.length, 0);
});

test('PiRunnerEngineAdapter forwards prior conversation as RunnerSpec.messages and persists assistant_message', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  let capturedMessages: unknown[] | undefined;
  const { template } = fakeTemplate({
    onMaterialize: (ctx) => { capturedMessages = ctx.spec.messages; },
  });
  const adapter = new PiRunnerEngineAdapter({
    sandboxSession: fakeSession(), template, bundlePath: '/host/pi-runner.cjs',
    provider: 'openai', model: 'gpt-5.4-mini', env: {},
  });
  const session: SessionRecord = {
    id: 'w1', actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin: 'board:v1:proj:task-1', agentSpecId: 'coding-default',
    openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
  };
  const snap: SessionSnapshot = {
    session,
    history: [
      { sessionId: 'w1', eventIndex: 0, eventType: 'input', kind: 'channel.input', payload: { text: 'first' }, createdAt: new Date().toISOString() },
      { sessionId: 'w1', eventIndex: 1, eventType: 'turn', kind: 'assistant_message', payload: { role: 'assistant', content: [{ type: 'text', text: 'did first' }] }, createdAt: new Date().toISOString() },
      { sessionId: 'w1', eventIndex: 2, eventType: 'input', kind: 'channel.input', payload: { text: 'now also Y' }, createdAt: new Date().toISOString() },
    ],
  };
  await adapter.runTurn({ spec: spec(), session: snap, bus, signal: new AbortController().signal });
  assert.ok(capturedMessages);
  assert.equal(capturedMessages!.length, 3);
  const events = [];
  for await (const e of bus.replay('w1')) events.push(e);
  assert.ok(events.some((e) => e.kind === 'assistant_message'));
});

test('PiRunnerEngineAdapter appends a skills prompt section when the run pinned skills', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  let capturedPrompt: string | undefined;
  const { template } = fakeTemplate({
    onMaterialize: (ctx) => { capturedPrompt = ctx.spec.systemPrompt; },
  });
  const adapter = new PiRunnerEngineAdapter({
    sandboxSession: fakeSession(), template, bundlePath: '/host/pi-runner.cjs',
    provider: 'openai', model: 'm', env: {},
  });
  const snap = snapshot();
  snap.session.metadata = {
    effectiveScope: { targetPaths: ['.'], capabilities: ['filesystem', 'shell', 'skills'], skills: ['repo-orientation'] },
  };
  await adapter.runTurn({ spec: spec(), session: snap, bus, signal: new AbortController().signal });
  assert.match(capturedPrompt ?? '', /Skills/);
  assert.match(capturedPrompt ?? '', /repo-orientation/);
});


test('PiRunnerEngineAdapter omits prior tool_call events from replayed messages', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  let capturedMessages: unknown[] | undefined;
  const { template } = fakeTemplate({
    onMaterialize: (ctx) => { capturedMessages = ctx.spec.messages; },
  });
  const adapter = new PiRunnerEngineAdapter({
    sandboxSession: fakeSession(), template, bundlePath: '/host/pi-runner.cjs',
    provider: 'openai', model: 'gpt-5.4-mini', env: {},
  });
  const session: SessionRecord = {
    id: 'w1', actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin: 'board:v1:proj:task-1', agentSpecId: 'coding-default',
    openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
  };
  const snap: SessionSnapshot = {
    session,
    history: [
      { sessionId: 'w1', eventIndex: 0, eventType: 'input', kind: 'channel.input', payload: { text: 'Review auth' }, createdAt: new Date().toISOString() },
      { sessionId: 'w1', eventIndex: 1, eventType: 'turn', kind: 'assistant_message', payload: { role: 'assistant', content: [{ type: 'text', text: 'Worker completed the task.' }] }, createdAt: new Date().toISOString() },
      { sessionId: 'w1', eventIndex: 2, eventType: 'action', kind: 'tool_call.read', payload: { callId: 'call_x', name: 'read', args: {}, result: { success: true, output: 'contents' } }, createdAt: new Date().toISOString() },
      { sessionId: 'w1', eventIndex: 3, eventType: 'input', kind: 'channel.input', payload: { text: 'Also check logout' }, createdAt: new Date().toISOString() },
    ],
  };
  await adapter.runTurn({ spec: spec(), session: snap, bus, signal: new AbortController().signal });
  assert.ok(capturedMessages);
  assert.equal(capturedMessages!.length, 3);
  assert.ok(!(capturedMessages as { role: string }[]).some((m) => m.role === 'toolResult'));
});
