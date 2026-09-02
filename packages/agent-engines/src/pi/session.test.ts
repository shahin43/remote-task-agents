import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionContext } from './session.js';
import type { SessionEventRecord } from '@remote-sandbox-agents/contracts';

function event(idx: number, eventType: string, kind: string, payload: unknown): SessionEventRecord {
  return {
    sessionId: 's1',
    eventIndex: idx,
    eventType: eventType as SessionEventRecord['eventType'],
    kind,
    payload,
    createdAt: '',
  };
}

test('buildSessionContext reconstructs full multi-turn conversation', () => {
  const history = [
    event(0, 'input', 'channel.input', { text: 'Fix the login bug' }),
    event(1, 'turn', 'assistant_message', {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will dispatch a worker.' },
        { type: 'toolCall', id: 'tc1', name: 'dispatch_job', arguments: { goal: 'fix login' } },
      ],
    }),
    event(2, 'action', 'tool_call.dispatch_job', {
      callId: 'tc1', name: 'dispatch_job', args: { goal: 'fix login' },
      result: { success: true, output: 'dispatched' },
    }),
    event(3, 'input', 'child_session_completed', {
      childId: 'w1', status: 'succeeded', summary: 'Fixed the null check in auth.ts',
    }),
  ];

  const ctx = buildSessionContext(history, { includeToolResults: true });

  // user, assistant, toolResult, user(latest)
  assert.equal(ctx.messages.length, 4);
  assert.equal(ctx.messages[0]!.role, 'user');
  assert.equal(ctx.messages[1]!.role, 'assistant');
  assert.equal(ctx.messages[2]!.role, 'toolResult');
  assert.equal(ctx.messages[3]!.role, 'user');
  assert.ok(ctx.currentInput?.includes('succeeded'));
});

test('buildSessionContext keeps the latest input as the last message', () => {
  const history = [
    event(0, 'input', 'channel.input', { text: 'Hello' }),
    event(1, 'turn', 'assistant_message', { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }),
    event(2, 'input', 'child_session_completed', { childId: 'w1', status: 'succeeded', summary: 'Done' }),
  ];

  const ctx = buildSessionContext(history, { includeToolResults: true });
  const last = ctx.messages[ctx.messages.length - 1]!;
  assert.equal(last.role, 'user');
  assert.ok(ctx.currentInput?.includes('Done'));
});

test('buildSessionContext passes assistant_message through verbatim (caching invariant)', () => {
  const rawAssistant = {
    role: 'assistant',
    content: [{ type: 'text', text: 'verbatim' }],
    usage: { input: 10, output: 5 },
    extraProviderField: 'must-survive',
  };
  const history = [
    event(0, 'input', 'channel.input', { text: 'go' }),
    event(1, 'turn', 'assistant_message', rawAssistant),
  ];

  const ctx = buildSessionContext(history, { includeToolResults: true });
  // The assistant message must be the exact persisted object, untransformed.
  assert.deepEqual(ctx.messages[1], rawAssistant);
});

test('buildSessionContext maps tool_call action to a toolResult message', () => {
  const history = [
    event(0, 'input', 'channel.input', { text: 'Do X' }),
    event(1, 'turn', 'assistant_message', {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tc1', name: 'dispatch_job', arguments: { goal: 'X' } }],
    }),
    event(2, 'action', 'tool_call.dispatch_job', {
      callId: 'tc1', name: 'dispatch_job', args: { goal: 'X' },
      result: { success: false, output: 'boom' },
    }),
  ];

  const ctx = buildSessionContext(history, { includeToolResults: true });
  assert.equal(ctx.messages.length, 3);
  const toolResult = ctx.messages[2] as Record<string, unknown>;
  assert.equal(toolResult.role, 'toolResult');
  assert.equal(toolResult.toolCallId, 'tc1');
  assert.equal(toolResult.isError, true);
});

test('buildSessionContext omits tool_call actions when includeToolResults is false', () => {
  const history = [
    event(0, 'input', 'channel.input', { text: 'Review auth.ts' }),
    event(1, 'turn', 'assistant_message', {
      role: 'assistant',
      content: [{ type: 'text', text: 'Worker completed the task.' }],
    }),
    event(2, 'action', 'tool_call.read', {
      callId: 'call_abc', name: 'read', args: { path: 'auth.ts' },
      result: { success: true, output: 'file contents' },
    }),
    event(3, 'action', 'tool_call.bash', {
      callId: 'call_def', name: 'bash', args: { command: 'npm test' },
      result: { success: true, output: 'all passed' },
    }),
    event(4, 'input', 'channel.input', { text: 'Also check logout flow' }),
  ];

  const ctx = buildSessionContext(history, { includeToolResults: false });

  assert.equal(ctx.messages.length, 3);
  assert.equal(ctx.messages[0]!.role, 'user');
  assert.equal(ctx.messages[1]!.role, 'assistant');
  assert.equal(ctx.messages[2]!.role, 'user');
  assert.equal(ctx.currentInput, 'Also check logout flow');
});

test('buildSessionContext returns empty context for empty history', () => {
  const ctx = buildSessionContext([]);
  assert.equal(ctx.messages.length, 0);
  assert.equal(ctx.currentInput, null);
});

test('buildSessionContext ignores legacy final_message events', () => {
  const history = [
    event(0, 'input', 'channel.input', { text: 'hi' }),
    event(1, 'turn', 'final_message', { text: 'legacy text', usage: { input: 1, output: 1 } }),
  ];

  const ctx = buildSessionContext(history, { includeToolResults: true });
  // Only the user input becomes a message; final_message is skipped.
  assert.equal(ctx.messages.length, 1);
  assert.equal(ctx.messages[0]!.role, 'user');
});

test('buildSessionContext maps run.summary to a user message', () => {
  const history = [
    event(0, 'input', 'run.summary', { text: '## Prior run (attempt 1)\nStatus: succeeded' }),
    event(1, 'input', 'channel.input', { text: 'follow up' }),
  ];
  const ctx = buildSessionContext(history, { includeToolResults: false });
  assert.equal(ctx.messages.length, 2);
  assert.match(String(ctx.messages[0]!.content), /Prior run/);
  assert.equal(ctx.currentInput, 'follow up');
});
