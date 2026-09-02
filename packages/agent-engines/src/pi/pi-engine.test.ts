import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PiCodingAgentEngine, type PiAiLike, type PiAiModel, type PiAiContext, type PiAiMessage, type PiAiStream, type PiAiStreamEvent, type PiAiStreamOptions } from './pi-engine.js';
import { InMemorySessionEventsRepo, InMemoryAgentBus } from '@remote-sandbox-agents/persistence';
import type { AgentSpec, ToolProvider, ToolDescriptor, ToolScope } from '@remote-sandbox-agents/contracts';

function fakePiAi(
  scriptedToolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }>,
  finalText?: string,
): PiAiLike {
  let callCount = 0;
  return {
    getModel: (provider, id) => ({ id, provider }),
    stream: (_model: PiAiModel, _context: PiAiContext): PiAiStream => {
      callCount++;
      // First call: emit scripted tool calls. Subsequent calls: just finish.
      const isFirst = callCount === 1;
      const events: PiAiStreamEvent[] = [];
      const content: PiAiMessage['content'] = [];

      if (isFirst) {
        for (const c of scriptedToolCalls) {
          events.push({
            type: 'toolcall_end',
            toolCall: { type: 'toolCall', id: c.id ?? `call-${c.name}`, name: c.name, arguments: c.args },
          });
          content.push({ type: 'toolCall', id: c.id ?? `call-${c.name}`, name: c.name, arguments: c.args });
        }
      }
      if (finalText && (!isFirst || scriptedToolCalls.length === 0)) {
        events.push({ type: 'text_delta', delta: finalText });
        content.push({ type: 'text', text: finalText });
      }

      const msg: PiAiMessage = { role: 'assistant', content, usage: { input: 10, output: 5, cost: { total: 0.001 } } };
      let idx = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (idx < events.length) return { value: events[idx++]!, done: false };
              return { value: undefined as unknown as PiAiStreamEvent, done: true };
            },
          };
        },
        result: async () => msg,
      };
    },
    Type: {
      Object: (props) => ({ type: 'object', properties: props }),
      String: (opts) => ({ type: 'string', ...opts }),
      Optional: (s) => s,
    },
  };
}

function fakeProvider(): ToolProvider {
  return {
    list: () => [{ name: 'dispatch_job', toolset: 'core', schema: { description: 'Dispatch a job' } } as ToolDescriptor],
    invoke: async () => ({ success: true, output: 'dispatched' }),
  };
}

function fakeSpec(): AgentSpec {
  return {
    id: 'orchestrator-supervisor',
    actor: 'orchestrator',
    engine: { kind: 'pi-agent' },
    prompt: { assemble: async () => ({ system: 'SYSTEM PROMPT', cacheBreakpoints: [], hash: '' }) },
    tools: fakeProvider(),
    skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' },
    workspace: { kind: 'none', prepare: async () => ({ cleanupHints: { retention: 'delete-on-success' }, metadata: {} }), cleanup: async () => {} },
    secrets: { resolve: async () => ({}) } as never,
    fs: { mode: 'none' },
    policies: { approvalPolicy: 'never', maxTurns: 5, turnTimeoutMs: 60_000, maxToolCalls: 8, maxRuntimeMinutes: 5 },
    metadata: {},
  };
}

test('PiCodingAgentEngine emits tool_call_only when turn has tool calls and no text', async () => {
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const engine = new PiCodingAgentEngine({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    piAi: fakePiAi([{ name: 'dispatch_job', args: { goal: 'AGE-7' } }]),
  });
  const result = await engine.runTurn({
    spec: fakeSpec(),
    session: {
      session: {
        id: 's1', actor: 'orchestrator', parentSessionId: null, status: 'open',
        channelOrigin: 'linear:AGE-7', agentSpecId: 'orchestrator-supervisor',
        openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
      },
      history: [
        { sessionId: 's1', eventIndex: 0, eventType: 'input', kind: 'channel.input', payload: { text: 'Please look at AGE-7' }, createdAt: new Date().toISOString() },
      ],
    },
    bus,
    signal: new AbortController().signal,
  });
  assert.equal(result.finishReason, 'tool_call_only');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.name, 'dispatch_job');
  assert.equal(result.toolCalls[0]?.result.success, true);
  assert.equal(result.toolCalls[0]?.result.output, 'dispatched');
});

test('PiCodingAgentEngine returns completed with finalMessage when no tool calls', async () => {
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const engine = new PiCodingAgentEngine({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    piAi: fakePiAi([], 'Done.'),
  });
  const result = await engine.runTurn({
    spec: fakeSpec(),
    session: {
      session: {
        id: 's1', actor: 'orchestrator', parentSessionId: null, status: 'open',
        channelOrigin: null, agentSpecId: 'orchestrator-supervisor',
        openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
      },
      history: [
        { sessionId: 's1', eventIndex: 0, eventType: 'input', kind: 'channel.input', payload: { text: 'hi' }, createdAt: new Date().toISOString() },
      ],
    },
    bus,
    signal: new AbortController().signal,
  });
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.finalMessage, 'Done.');
});

test('PiCodingAgentEngine returns completed with no action when history is empty', async () => {
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const engine = new PiCodingAgentEngine({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    piAi: fakePiAi([]),
  });
  const result = await engine.runTurn({
    spec: fakeSpec(),
    session: {
      session: {
        id: 's1', actor: 'orchestrator', parentSessionId: null, status: 'open',
        channelOrigin: null, agentSpecId: 'orchestrator-supervisor',
        openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
      },
      history: [],
    },
    bus,
    signal: new AbortController().signal,
  });
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.toolCalls.length, 0);
});

/** Fake that records the stream options it was given and emits cache usage. */
function instrumentedPiAi(record: { options: PiAiStreamOptions | undefined }): PiAiLike {
  return {
    getModel: (provider, id) => ({ id, provider }),
    stream: (_model: PiAiModel, _context: PiAiContext, options?: PiAiStreamOptions): PiAiStream => {
      record.options = options;
      const msg: PiAiMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        usage: { input: 100, output: 10, cacheRead: 80, cacheWrite: 20 },
      };
      return {
        [Symbol.asyncIterator]() {
          let done = false;
          return {
            next: async () => {
              if (done) return { value: undefined as unknown as PiAiStreamEvent, done: true };
              done = true;
              return { value: { type: 'text_delta', delta: 'done' }, done: false };
            },
          };
        },
        result: async () => msg,
      };
    },
    Type: {
      Object: (props) => ({ type: 'object', properties: props }),
      String: (opts) => ({ type: 'string', ...opts }),
      Optional: (s) => s,
    },
  };
}

function runInput(bus: InMemoryAgentBus) {
  return {
    spec: fakeSpec(),
    session: {
      session: {
        id: 's1', actor: 'orchestrator' as const, parentSessionId: null, status: 'open' as const,
        channelOrigin: null, agentSpecId: 'orchestrator-supervisor',
        openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
      },
      history: [
        { sessionId: 's1', eventIndex: 0, eventType: 'input' as const, kind: 'channel.input', payload: { text: 'hi' }, createdAt: new Date().toISOString() },
      ],
    },
    bus,
    signal: new AbortController().signal,
  };
}

test('PiCodingAgentEngine captures cacheRead/cacheWrite usage', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const record: { options: PiAiStreamOptions | undefined } = { options: undefined };
  const engine = new PiCodingAgentEngine({ provider: 'openai', model: 'm', piAi: instrumentedPiAi(record) });
  const result = await engine.runTurn(runInput(bus));
  assert.equal(result.usage?.cacheReadTokens, 80);
  assert.equal(result.usage?.cacheWriteTokens, 20);
});

test('PiCodingAgentEngine does not pass stream options by default (store stays off)', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const record: { options: PiAiStreamOptions | undefined } = { options: undefined };
  const engine = new PiCodingAgentEngine({ provider: 'openai', model: 'm', piAi: instrumentedPiAi(record) });
  await engine.runTurn(runInput(bus));
  assert.equal(record.options, undefined);
});

test('PiCodingAgentEngine with storeRequests sets store:true via onPayload', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const record: { options: PiAiStreamOptions | undefined } = { options: undefined };
  const engine = new PiCodingAgentEngine({ provider: 'openai', model: 'm', storeRequests: true, piAi: instrumentedPiAi(record) });
  await engine.runTurn(runInput(bus));
  assert.ok(record.options?.onPayload, 'expected an onPayload hook when storeRequests is true');
  const payload = record.options!.onPayload!({ model: 'm', store: false }, { id: 'm', provider: 'openai' });
  assert.equal((payload as { store: boolean }).store, true);
});

/** ToolProvider that records which scope the engine requested. */
function scopeRecordingProvider(seen: { scope?: ToolScope }): ToolProvider {
  return {
    list: (scope) => {
      seen.scope = scope;
      return [{ name: `${scope}_tool`, toolset: 'core', schema: { description: 'd' } } as ToolDescriptor];
    },
    invoke: async () => ({ success: true, output: 'ok' }),
  };
}

test('PiCodingAgentEngine lists worker-scope tools when spec.actor is worker', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const seen: { scope?: ToolScope } = {};
  const engine = new PiCodingAgentEngine({ provider: 'openai', model: 'm', piAi: fakePiAi([], 'done') });
  await engine.runTurn({ ...runInput(bus), spec: { ...fakeSpec(), actor: 'worker', tools: scopeRecordingProvider(seen) } });
  assert.equal(seen.scope, 'worker');
});

test('PiCodingAgentEngine lists orchestrator-scope tools when spec.actor is orchestrator', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const seen: { scope?: ToolScope } = {};
  const engine = new PiCodingAgentEngine({ provider: 'openai', model: 'm', piAi: fakePiAi([], 'done') });
  await engine.runTurn({ ...runInput(bus), spec: { ...fakeSpec(), actor: 'orchestrator', tools: scopeRecordingProvider(seen) } });
  assert.equal(seen.scope, 'orchestrator');
});

/** ToolProvider that records the workspacePath passed at invoke time. */
function workspaceRecordingProvider(seen: { workspacePath?: string }): ToolProvider {
  return {
    list: () => [{ name: 'shell', toolset: 'core', schema: { description: 'd' } } as ToolDescriptor],
    invoke: async (_n, _a, ctx) => {
      seen.workspacePath = ctx.workspacePath;
      return { success: true, output: 'ok' };
    },
  };
}

test('PiCodingAgentEngine invokes tools with the spec filesystem root as workspacePath', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const seen: { workspacePath?: string } = {};
  const engine = new PiCodingAgentEngine({
    provider: 'openai', model: 'm', piAi: fakePiAi([{ name: 'shell', args: { cmd: 'ls' } }], 'done'),
  });
  const spec: AgentSpec = { ...fakeSpec(), actor: 'worker', fs: { mode: 'scoped', root: '/workspace' }, tools: workspaceRecordingProvider(seen) };
  await engine.runTurn({ ...runInput(bus), spec });
  assert.equal(seen.workspacePath, '/workspace');
});

test('PiCodingAgentEngine falls back to /dev/null when the spec has no filesystem root', async () => {
  const bus = new InMemoryAgentBus(new InMemorySessionEventsRepo());
  const seen: { workspacePath?: string } = {};
  const engine = new PiCodingAgentEngine({
    provider: 'openai', model: 'm', piAi: fakePiAi([{ name: 'shell', args: { cmd: 'ls' } }], 'done'),
  });
  const spec: AgentSpec = { ...fakeSpec(), tools: workspaceRecordingProvider(seen) };
  await engine.runTurn({ ...runInput(bus), spec });
  assert.equal(seen.workspacePath, '/dev/null');
});
