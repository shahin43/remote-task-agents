import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';
import type { ToolInvocationContext } from '@remote-sandbox-agents/contracts';
import { makeSandboxToolProvider } from './sandbox-tool-pack.js';

const ctx: ToolInvocationContext = { workspacePath: '/workspace', runId: 'r1', profileId: 'coding' };

function fakeSession(overrides: Partial<SandboxSession> = {}): SandboxSession {
  return {
    state: { type: 'unix_local', sessionId: 's1', workspaceRoot: '/workspace' },
    start: async () => {},
    exec: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
    read: async () => Readable.from(['file-contents']),
    write: async () => {},
    persistWorkspace: async () => Readable.from(['']),
    stop: async () => {},
    ...overrides,
  } as SandboxSession;
}

test('provider exposes shell/read_file/write_file under the worker scope', () => {
  const provider = makeSandboxToolProvider(fakeSession());
  const names = provider.list('worker').map((d) => d.name).sort();
  assert.deepEqual(names, ['read_file', 'shell', 'write_file']);
  assert.deepEqual(provider.list('orchestrator'), []);
});

test('shell delegates to session.exec and reports success on exit 0', async () => {
  const calls: Array<string | string[]> = [];
  const provider = makeSandboxToolProvider(fakeSession({
    exec: async (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: 'hello', stderr: '' }; },
  }));
  const res = await provider.invoke('shell', { cmd: 'echo hello' }, ctx);
  assert.equal(res.success, true);
  assert.deepEqual(calls, ['echo hello']);
  assert.equal(JSON.parse(res.output).stdout, 'hello');
});

test('shell reports failure on non-zero exit', async () => {
  const provider = makeSandboxToolProvider(fakeSession({
    exec: async () => ({ exitCode: 2, stdout: '', stderr: 'boom' }),
  }));
  const res = await provider.invoke('shell', { cmd: 'false' }, ctx);
  assert.equal(res.success, false);
  assert.match(res.error ?? '', /exit 2/);
});

test('read_file streams the sandbox file contents', async () => {
  const provider = makeSandboxToolProvider(fakeSession({ read: async () => Readable.from(['abc', 'def']) }));
  const res = await provider.invoke('read_file', { path: 'a.txt' }, ctx);
  assert.equal(res.success, true);
  assert.equal(res.output, 'abcdef');
});

test('write_file delegates to session.write', async () => {
  const writes: Array<{ path: string; data: unknown }> = [];
  const provider = makeSandboxToolProvider(fakeSession({
    write: async (path, data) => { writes.push({ path, data }); },
  }));
  const res = await provider.invoke('write_file', { path: 'out.txt', content: 'hi' }, ctx);
  assert.equal(res.success, true);
  assert.deepEqual(writes, [{ path: 'out.txt', data: 'hi' }]);
});

test('tool errors surface as failed ToolResults, not throws', async () => {
  const provider = makeSandboxToolProvider(fakeSession({
    exec: async () => { throw new Error('sandbox gone'); },
  }));
  const res = await provider.invoke('shell', { cmd: 'x' }, ctx);
  assert.equal(res.success, false);
  assert.match(res.error ?? '', /sandbox gone/);
});
