import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPiLoop, type PiLoopEvent } from './loop.js';
import type { PiAiLike, PiAiModel, PiAiContext, PiAiMessage, PiAiStream, PiAiStreamEvent, PiAiStreamOptions } from './pi-engine.js';

function fakePiAi(
  scriptedToolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }>,
  finalText?: string,
): PiAiLike {
  let callCount = 0;
  return {
    getModel: (provider, id) => ({ id, provider }),
    stream: (_model: PiAiModel, _context: PiAiContext): PiAiStream => {
      callCount++;
      const isFirst = callCount === 1;
      const events: PiAiStreamEvent[] = [];
      const content: PiAiMessage['content'] = [];
      if (isFirst) {
        for (const c of scriptedToolCalls) {
          events.push({ type: 'toolcall_end', toolCall: { type: 'toolCall', id: c.id ?? `call-${c.name}`, name: c.name, arguments: c.args } });
          content.push({ type: 'toolCall', id: c.id ?? `call-${c.name}`, name: c.name, arguments: c.args });
        }
      }
      if (finalText && (!isFirst || scriptedToolCalls.length === 0)) {
        events.push({ type: 'text_delta', delta: finalText });
        content.push({ type: 'text', text: finalText });
      }
      const msg: PiAiMessage = { role: 'assistant', content, usage: { input: 10, output: 5, cacheRead: 4, cacheWrite: 1 } };
      let idx = 0;
      return {
        [Symbol.asyncIterator]() {
          return { next: async () => (idx < events.length ? { value: events[idx++]!, done: false } : { value: undefined as unknown as PiAiStreamEvent, done: true }) };
        },
        result: async () => msg,
      };
    },
    Type: { Object: (p) => ({ type: 'object', properties: p }), String: (o) => ({ type: 'string', ...o }), Optional: (s) => s },
  };
}

test('runPiLoop executes tools then completes, reporting usage and events', async () => {
  const calls: string[] = [];
  const events: PiLoopEvent[] = [];
  const res = await runPiLoop({
    piAi: fakePiAi([{ name: 'shell', args: { cmd: 'ls' } }], 'all done'),
    provider: 'openai', model: 'm', systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    toolDefs: [{ name: 'shell', description: 'run', parameters: {} }],
    invokeTool: async (name) => { calls.push(name); return { success: true, output: 'ok' }; },
    maxTurns: 5, signal: new AbortController().signal,
    onEvent: (e) => events.push(e),
  });
  assert.deepEqual(calls, ['shell']);
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.finalMessage, 'all done');
  assert.equal(res.finishReason, 'completed');
  assert.equal(res.usage?.cacheReadTokens, 8); // 4 per turn × 2 turns (tool turn + final turn)
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.name, 'shell');
});

test('runPiLoop returns tool_call_only when tools ran but no text was produced', async () => {
  const res = await runPiLoop({
    piAi: fakePiAi([{ name: 'shell', args: {} }]),
    provider: 'openai', model: 'm', systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    toolDefs: [{ name: 'shell', description: 'run', parameters: {} }],
    invokeTool: async () => ({ success: true, output: 'ok' }),
    maxTurns: 5, signal: new AbortController().signal,
  });
  assert.equal(res.finishReason, 'tool_call_only');
});

test('runPiLoop formats object-shaped stream errors', async () => {
  const piAi: PiAiLike = {
    getModel: (provider, id) => ({ id, provider }),
    stream: () => ({
      [Symbol.asyncIterator]() {
        let done = false;
        return {
          next: async () => {
            if (done) return { value: undefined as unknown as PiAiStreamEvent, done: true };
            done = true;
            return {
              value: {
                type: 'error',
                error: { errorMessage: 'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.' },
              },
              done: false,
            };
          },
        };
      },
      result: async () => ({ role: 'assistant', content: [] }),
    }),
    Type: { Object: (p) => p, String: (o) => o, Optional: (s) => s },
  };
  const res = await runPiLoop({
    piAi,
    provider: 'openai',
    model: 'm',
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    toolDefs: [],
    invokeTool: async () => ({ success: true, output: '' }),
    maxTurns: 3,
    signal: new AbortController().signal,
  });
  assert.equal(res.finishReason, 'error');
  assert.match(res.errorMessage ?? '', /OPENAI API key is required/i);
});

test('runPiLoop sets store:true via onPayload when storeRequests is on', async () => {
  let seen: PiAiStreamOptions | undefined;
  const piAi = fakePiAi([], 'done');
  const wrapped: PiAiLike = { ...piAi, stream: (m, c, o) => { seen = o; return piAi.stream(m, c, o); } };
  await runPiLoop({
    piAi: wrapped, provider: 'openai', model: 'm', systemPrompt: 's',
    messages: [{ role: 'user', content: 'hi' }], toolDefs: [],
    invokeTool: async () => ({ success: true, output: '' }),
    maxTurns: 3, signal: new AbortController().signal, storeRequests: true,
  });
  assert.ok(seen?.onPayload);
  const payload = seen!.onPayload!({ store: false }, { id: 'm', provider: 'openai' });
  assert.equal((payload as { store: boolean }).store, true);
});
