import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runMain } from './pi-runner-entry.js';
import type { PiAiLike, PiAiModel, PiAiContext, PiAiMessage, PiAiStream, PiAiStreamEvent } from './pi-engine.js';

/** Fake pi-ai: turn 1 calls write_file, turn 2 emits final text. */
function fakePiAiWrites(relPath: string, content: string, finalText: string): PiAiLike {
  let callCount = 0;
  return {
    getModel: (provider, id) => ({ id, provider }),
    stream: (_m: PiAiModel, _c: PiAiContext): PiAiStream => {
      callCount++;
      const first = callCount === 1;
      const events: PiAiStreamEvent[] = [];
      const blocks: PiAiMessage['content'] = [];
      if (first) {
        const call = { type: 'toolCall' as const, id: 'c1', name: 'write_file', arguments: { path: relPath, content } };
        events.push({ type: 'toolcall_end', toolCall: call });
        blocks.push(call);
      } else {
        events.push({ type: 'text_delta', delta: finalText });
        blocks.push({ type: 'text', text: finalText });
      }
      const msg: PiAiMessage = { role: 'assistant', content: blocks, usage: { input: 5, output: 2 } };
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return { next: async () => (i < events.length ? { value: events[i++]!, done: false } : { value: undefined as unknown as PiAiStreamEvent, done: true }) };
        },
        result: async () => msg,
      };
    },
    Type: { Object: (p) => ({ type: 'object', properties: p }), String: (o) => ({ type: 'string', ...o }), Optional: (s) => s },
  };
}

async function makeWorkspace(input: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-runner-'));
  await fs.mkdir(path.join(root, 'repo'), { recursive: true });
  await fs.mkdir(path.join(root, 'task'), { recursive: true });
  await fs.mkdir(path.join(root, '.agent'), { recursive: true });
  await fs.writeFile(path.join(root, '.agent/spec.json'), JSON.stringify({
    profileId: 'coding-default', provider: 'openai', model: 'm', maxTurns: 5,
    systemPrompt: 'you are a coder', input,
  }));
  await fs.writeFile(path.join(root, 'task/scope.json'), JSON.stringify({
    targetPaths: ['.'], capabilities: ['filesystem', 'shell'], skills: [],
  }));
  return root;
}

test('runMain runs the pi loop in the workspace and writes artifacts', async () => {
  const root = await makeWorkspace('create repo/out.txt');
  // File tools are workspace-rooted (post-2026-06-29 fix), so the agent
  // writes `repo/out.txt` (workspace-relative path) and the file lands at
  // <root>/repo/out.txt. This regresses if anyone re-introduces the
  // pi-runner-entry "buildLocalTools(repoRoot, …)" path-doubling bug.
  const result = await runMain(root, { piAi: fakePiAiWrites('repo/out.txt', 'generated', 'Created repo/out.txt as requested.') });

  assert.equal(result.status, 'completed');
  assert.equal(result.toolCount, 1);

  const summary = await fs.readFile(path.join(root, 'artifacts/summary.md'), 'utf8');
  assert.match(summary, /Created repo\/out\.txt/);

  const out = await fs.readFile(path.join(root, 'repo/out.txt'), 'utf8');
  assert.equal(out, 'generated');

  const events = await fs.readFile(path.join(root, '.agent/events.jsonl'), 'utf8');
  assert.match(events, /tool_call/);
  assert.match(events, /write_file/);
});

test('runMain reports failure when the spec is missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-runner-empty-'));
  const result = await runMain(root, { piAi: fakePiAiWrites('x', 'y', 'z') });
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /missing/);
});

test('runMain seeds the pi loop from spec.messages when present', async () => {
  const received: PiAiMessage[][] = [];
  const piAi: PiAiLike = {
    getModel: (provider, id) => ({ id, provider }),
    stream: (_m, ctx) => {
      received.push([...(ctx.messages as PiAiMessage[])]);
      const msg: PiAiMessage = { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input: 1, output: 1 } };
      return {
        [Symbol.asyncIterator]() {
          return { next: async () => ({ value: undefined as unknown as PiAiStreamEvent, done: true }) };
        },
        result: async () => msg,
      };
    },
    Type: { Object: (p) => ({ type: 'object', properties: p }), String: (o) => ({ type: 'string', ...o }), Optional: (s) => s },
  };

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-runner-msgs-'));
  await fs.mkdir(path.join(root, 'repo'), { recursive: true });
  await fs.mkdir(path.join(root, 'task'), { recursive: true });
  await fs.mkdir(path.join(root, '.agent'), { recursive: true });
  await fs.writeFile(path.join(root, '.agent/spec.json'), JSON.stringify({
    profileId: 'coding-default', provider: 'openai', model: 'm', maxTurns: 1,
    systemPrompt: 'sys', input: 'latest',
    messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'did first' }] },
      { role: 'user', content: 'latest' },
    ],
  }));
  await fs.writeFile(path.join(root, 'task/scope.json'), JSON.stringify({
    targetPaths: ['.'], capabilities: ['filesystem'], skills: [],
  }));

  await runMain(root, { piAi });
  assert.equal(received.length, 1);
  assert.equal(received[0]!.length, 3);
  const first = received[0]![0]!;
  assert.equal(first.role, 'user');
  assert.equal(typeof first.content === 'string' ? first.content : '', 'first');
});
