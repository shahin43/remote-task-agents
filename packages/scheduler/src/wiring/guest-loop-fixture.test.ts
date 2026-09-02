import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runPiRunner, type PiAiLike, type PiAiMessage, type PiAiModel, type PiAiStream, type PiAiStreamEvent } from '@remote-sandbox-agents/agent-engines';
import { UnixLocalSandboxProvider } from '@remote-sandbox-agents/sandbox';

import { bundleToManifest } from './task-bundle.js';
import {
  GUEST_LOOP_CAPABILITIES,
  GUEST_LOOP_GREETING_BODY,
  GUEST_LOOP_GREETING_PATH,
  GUEST_LOOP_SKILL_IDS,
  buildGuestLoopFixture,
} from './guest-loop-fixture.js';

/** Fake pi-ai: read_skill (platform) → read_skill (custom) → write_file → final text. */
function scriptedGuestLoopPiAi(): PiAiLike {
  const steps: PiAiStreamEvent[][] = [
    [{
      type: 'toolcall_end',
      toolCall: { type: 'toolCall', id: 'c1', name: 'read_skill', arguments: { id: 'repo-orientation' } },
    }],
    [{
      type: 'toolcall_end',
      toolCall: { type: 'toolCall', id: 'c2', name: 'read_skill', arguments: { id: 'hello-fixture' } },
    }],
    [{
      type: 'toolcall_end',
      toolCall: {
        type: 'toolCall',
        id: 'c3',
        name: 'write_file',
        arguments: { path: GUEST_LOOP_GREETING_PATH, content: GUEST_LOOP_GREETING_BODY },
      },
    }],
    [{ type: 'text_delta', delta: 'Wrote the greeting file as instructed by hello-fixture.' }],
  ];
  let callCount = 0;
  return {
    getModel: (provider, id) => ({ id, provider }),
    stream: (_m: PiAiModel): PiAiStream => {
      const events = steps[Math.min(callCount, steps.length - 1)]!;
      callCount++;
      const blocks: PiAiMessage['content'] = [];
      for (const event of events) {
        if (event.toolCall) blocks.push(event.toolCall);
        if (event.type === 'text_delta' && event.delta) blocks.push({ type: 'text', text: event.delta });
      }
      const msg: PiAiMessage = { role: 'assistant', content: blocks, usage: { input: 4, output: 2 } };
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () => (i < events.length
              ? { value: events[i++]!, done: false }
              : { value: undefined as unknown as PiAiStreamEvent, done: true }),
          };
        },
        result: async () => msg,
      };
    },
    Type: { Object: (p) => ({ type: 'object', properties: p }), String: (o) => ({ type: 'string', ...o }), Optional: (s) => s },
  };
}

test('guest-loop fixture mounts skills and git repo through TaskBundle', async () => {
  const fixture = await buildGuestLoopFixture();
  try {
    const skillIds = fixture.bundle.skills.map((s) => s.id).sort();
    assert.deepEqual(skillIds, [...GUEST_LOOP_SKILL_IDS]);
    assert.equal(fixture.bundle.skills.find((s) => s.id === 'repo-orientation')?.source, 'platform');
    assert.equal(fixture.bundle.skills.find((s) => s.id === 'hello-fixture')?.source, 'tenant');

    const index = fixture.bundle.files.find((f) => f.dest === 'skills/INDEX.md');
    assert.ok(index, 'skills/INDEX.md missing from bundle');
    assert.match(index.content, /repo-orientation/);
    assert.match(index.content, /hello-fixture/);
    assert.match(index.content, /read_skill/);

    const specFile = fixture.bundle.files.find((f) => f.dest === '.agent/spec.json');
    assert.ok(specFile);
    const spec = JSON.parse(specFile.content) as { profileId: string; systemPrompt: string; maxTurns: number };
    assert.equal(spec.profileId, 'coder');
    assert.match(spec.systemPrompt, /Skills/);
    assert.ok(spec.maxTurns >= 4);

    const scopeFile = fixture.bundle.files.find((f) => f.dest === 'task/scope.json');
    assert.ok(scopeFile);
    const scope = JSON.parse(scopeFile.content) as { capabilities: string[]; skills: string[] };
    assert.deepEqual(scope.capabilities, [...GUEST_LOOP_CAPABILITIES]);
    assert.deepEqual([...scope.skills].sort(), [...GUEST_LOOP_SKILL_IDS]);

    const repo = fixture.bundle.repos.find((r) => r.dest === 'repo');
    assert.ok(repo?.worktreePath);
    assert.equal(repo.worktreePath, fixture.repoDir);

    const manifest = bundleToManifest(fixture.bundle);
    assert.equal(manifest.entries['skills/repo-orientation/SKILL.md']?.type, 'inline_file');
    assert.equal(manifest.entries['skills/hello-fixture/SKILL.md']?.type, 'inline_file');
    assert.equal(manifest.entries.repo?.type, 'local_dir');
  } finally {
    await fixture.cleanup();
  }
});

test('guest-loop fake Pi run writes greeting + artifacts via TaskBundle mount', async () => {
  const fixture = await buildGuestLoopFixture();
  const workspacesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-guest-loop-unix-'));
  const provider = new UnixLocalSandboxProvider({ workspacesRoot });
  const session = await provider.create({
    manifest: bundleToManifest(fixture.bundle),
    options: { type: 'unix_local' },
  });
  try {
    await session.start();
    const result = await runPiRunner(session.state.workspaceRoot, { piAi: scriptedGuestLoopPiAi() });
    assert.equal(result.status, 'completed', result.error);
    assert.equal(result.toolCount, 3);

    const greeting = await fs.readFile(path.join(session.state.workspaceRoot, GUEST_LOOP_GREETING_PATH), 'utf8');
    assert.equal(greeting, GUEST_LOOP_GREETING_BODY);

    const summary = await fs.readFile(path.join(session.state.workspaceRoot, 'artifacts/summary.md'), 'utf8');
    assert.match(summary, /greeting/i);

    const events = await fs.readFile(path.join(session.state.workspaceRoot, '.agent/events.jsonl'), 'utf8');
    assert.match(events, /read_skill/);
    assert.match(events, /repo-orientation/);
    assert.match(events, /hello-fixture/);
    assert.match(events, /write_file/);
  } finally {
    await provider.destroy(session);
    await fixture.cleanup();
    await fs.rm(workspacesRoot, { recursive: true, force: true });
  }
});
