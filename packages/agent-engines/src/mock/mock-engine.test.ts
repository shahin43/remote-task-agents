import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgentEngine } from './mock-engine.js';
import type { AgentSpec, AgentEngineInput, ToolProvider } from '@remote-sandbox-agents/contracts';
import { InMemorySessionEventsRepo, InMemoryAgentBus } from '@remote-sandbox-agents/persistence';

function fakeTools(): ToolProvider {
  return {
    list: () => [],
    invoke: async () => ({ success: true, output: 'ok' }),
  };
}

function fakeSpec(): AgentSpec {
  return {
    id: 'orchestrator-supervisor',
    actor: 'orchestrator',
    engine: { kind: 'mock' },
    prompt: { assemble: async () => ({ system: '', cacheBreakpoints: [], hash: '' }) },
    tools: fakeTools(),
    skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' },
    workspace: { kind: 'none', prepare: async () => ({ cleanupHints: { retention: 'delete-on-success' }, metadata: {} }), cleanup: async () => {} },
    secrets: { resolve: async () => ({}) } as never,
    fs: { mode: 'none' },
    policies: { approvalPolicy: 'never', maxTurns: 1, turnTimeoutMs: 60_000, maxToolCalls: 8, maxRuntimeMinutes: 5 },
    metadata: {},
  };
}

test('MockAgentEngine plays out scripted plans in order', async () => {
  const engine = new MockAgentEngine([
    { toolCalls: [{ name: 'dispatch_job', args: { goal: 'AGE-7' } }], finishReason: 'tool_call_only' },
    { finalMessage: 'all done', finishReason: 'completed' },
  ]);
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const session = {
    session: {
      id: 's1', actor: 'orchestrator' as const, parentSessionId: null, status: 'open' as const,
      channelOrigin: 'linear:AGE-7', agentSpecId: 'orchestrator-supervisor',
      openedAt: new Date().toISOString(), closedAt: null, lastActivityAt: new Date().toISOString(), metadata: {},
    },
    history: [],
  };
  const input: AgentEngineInput = { spec: fakeSpec(), session, bus, signal: new AbortController().signal };
  const first = await engine.runTurn(input);
  assert.equal(first.finishReason, 'tool_call_only');
  assert.equal(first.toolCalls.length, 1);
  const second = await engine.runTurn(input);
  assert.equal(second.finishReason, 'completed');
  assert.equal(second.finalMessage, 'all done');
});
