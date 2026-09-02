import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';
import { piRunnerTemplate } from './agent-runtime-template.js';

/** Minimal in-memory fake SandboxSession recording writes/execs and serving reads. */
function fakeSession(root = '/workspace'): SandboxSession & { files: Map<string, string>; execs: string[][] } {
  const files = new Map<string, string>();
  const execs: string[][] = [];
  return {
    files,
    execs,
    state: { type: 'unix_local', sessionId: 's1', workspaceRoot: root },
    start: async () => {},
    exec: async (cmd) => { execs.push(Array.isArray(cmd) ? cmd : [cmd]); return { exitCode: 0, stdout: '', stderr: '' }; },
    read: async (p) => {
      if (!files.has(p)) throw new Error(`no such file: ${p}`);
      return Readable.from([files.get(p)!]);
    },
    write: async (p, data) => { files.set(p, typeof data === 'string' ? data : data.toString()); },
    persistWorkspace: async () => Readable.from(['']),
    stop: async () => {},
  };
}

async function tmpBundle(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-'));
  const file = path.join(dir, 'pi-runner.bundle.cjs');
  await fs.writeFile(file, '// fake bundle\n');
  return file;
}

test('piRunnerTemplate.materialize writes the bundle, spec and scope', async () => {
  const session = fakeSession();
  const bundlePath = await tmpBundle();
  await piRunnerTemplate.materialize(session, {
    spec: { profileId: 'coding-default', provider: 'openai', model: 'm', maxTurns: 5, systemPrompt: 's', input: 'go' },
    scope: { targetPaths: ['.'], capabilities: ['filesystem', 'shell'], skills: [] },
    bundlePath,
  });
  assert.match(session.files.get('.agent/pi-runner.js') ?? '', /fake bundle/);
  assert.match(session.files.get('.agent/spec.json') ?? '', /coding-default/);
  assert.match(session.files.get('task/scope.json') ?? '', /filesystem/);
  assert.ok(session.execs.some((e) => e[0] === 'mkdir'));
});

test('piRunnerTemplate.launch returns the node command rooted at the workspace', () => {
  const session = fakeSession('/workspace');
  const { command, args } = piRunnerTemplate.launch(session);
  assert.equal(command, 'node');
  assert.deepEqual(args, ['/workspace/.agent/pi-runner.js', '/workspace']);
});

test('piRunnerTemplate.collect reads summary, events and usage', async () => {
  const session = fakeSession();
  session.files.set('artifacts/summary.md', '# Task summary\n\nDid the thing.\n');
  session.files.set('.agent/events.jsonl', JSON.stringify({ type: 'tool_call', at: 'now', data: { name: 'shell' } }) + '\n');
  session.files.set('.agent/usage.json', JSON.stringify({ inputTokens: 10, outputTokens: 3 }));
  const out = await piRunnerTemplate.collect(session);
  assert.equal(out.summary, 'Did the thing.');
  assert.equal(out.events.length, 1);
  assert.equal(out.usage?.inputTokens, 10);
});

test('piRunnerTemplate.collect reads artifacts sidecar and tolerates malformed json', async () => {
  const valid = fakeSession();
  valid.files.set('.agent/artifacts.json', JSON.stringify({
    artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true }],
  }));
  const validOut = await piRunnerTemplate.collect(valid);
  assert.deepEqual(validOut.artifacts, {
    artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true }],
  });

  const invalid = fakeSession();
  invalid.files.set('.agent/artifacts.json', '{oops');
  const invalidOut = await piRunnerTemplate.collect(invalid);
  assert.deepEqual(invalidOut.artifacts, { __invalidJson: true, raw: '{oops' });
});

test('piRunnerTemplate.collect tolerates missing artifacts', async () => {
  const session = fakeSession();
  const out = await piRunnerTemplate.collect(session);
  assert.equal(out.summary, '');
  assert.deepEqual(out.events, []);
  assert.equal(out.usage, undefined);
});
