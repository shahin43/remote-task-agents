import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkerSessionLogger } from './worker-session-logger.js';

test('WorkerSessionLogger writes messages and tool calls as JSONL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-'));
  try {
    const logger = new WorkerSessionLogger(dir);

    logger.logMessage({ role: 'assistant', content: [{ type: 'text', text: 'hello' }] });
    logger.logToolCall({ name: 'read_file', args: { path: 'foo.ts' }, result: { output: 'contents' }, durationMs: 50 });
    await logger.flush();

    const session = await fs.readFile(path.join(dir, 'session.jsonl'), 'utf8');
    const lines = session.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].role, 'assistant');

    const tools = await fs.readFile(path.join(dir, 'tool-calls.jsonl'), 'utf8');
    const toolLines = tools.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(toolLines.length, 1);
    assert.equal(toolLines[0].name, 'read_file');
    assert.equal(toolLines[0].durationMs, 50);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('WorkerSessionLogger appends across multiple flushes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-'));
  try {
    const logger = new WorkerSessionLogger(dir);

    logger.logMessage({ role: 'user', content: 'one' });
    await logger.flush();
    logger.logMessage({ role: 'assistant', content: 'two' });
    await logger.flush();

    const session = await fs.readFile(path.join(dir, 'session.jsonl'), 'utf8');
    const lines = session.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].content, 'one');
    assert.equal(lines[1].content, 'two');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('WorkerSessionLogger flush is a no-op when nothing buffered', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-'));
  try {
    const logger = new WorkerSessionLogger(dir);
    await logger.flush(); // should not throw, should not create empty files
    const entries = await fs.readdir(dir);
    assert.equal(entries.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
