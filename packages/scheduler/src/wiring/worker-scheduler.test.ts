import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySessionsRepo, InMemorySessionEventsRepo, InMemoryAgentBus } from '@remote-sandbox-agents/persistence';
import { WorkspaceManager } from '@remote-sandbox-agents/orchestrator';
import { MockAgentEngine } from '@remote-sandbox-agents/agent-engines';
import { WorkerScheduler } from './worker-scheduler.js';
import type { AgentSpec } from '@remote-sandbox-agents/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function workerSpec(): AgentSpec {
  return {
    id: 'coding-default',
    actor: 'worker',
    engine: { kind: 'mock' },
    prompt: { assemble: async () => ({ system: 'You are a coding worker.', cacheBreakpoints: [], hash: '' }) },
    tools: { list: () => [], invoke: async () => ({ success: true, output: '' }) },
    skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' },
    workspace: { kind: 'local', prepare: async () => ({ path: '/tmp/ws', cleanupHints: { retention: 'delete-on-success' }, metadata: {} }), cleanup: async () => {} },
    secrets: { resolve: async () => ({}) } as never,
    fs: { mode: 'scoped', root: '/tmp/ws' },
    policies: { approvalPolicy: 'never', maxTurns: 1, turnTimeoutMs: 60000, maxToolCalls: 200, maxRuntimeMinutes: 30 },
    metadata: {},
  };
}

test('WorkerScheduler claims a routing session and runs it to completion', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  const workspaceManager = new WorkspaceManager({ baseDir: tmpDir });

  // Create parent orchestrator session
  await sessions.create({
    id: 'orch-1', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: 'linear:AGE-10', agentSpecId: 'orchestrator-supervisor', metadata: {},
  });

  // Create child worker session (as dispatch_job would)
  await sessions.create({
    id: 'worker-1', actor: 'worker', parentSessionId: 'orch-1', status: 'routing',
    channelOrigin: 'linear:AGE-10', agentSpecId: 'coding-default',
    metadata: { goal: 'Write a hello world script', ticket: { key: 'AGE-10', title: 'Hello world' } },
  });

  const engine = new MockAgentEngine([
    { finalMessage: 'Created hello.py with print("Hello, World!")', finishReason: 'completed' },
  ]);

  const scheduler = new WorkerScheduler({
    sessions, bus, workspaceManager,
    resolveSpec: async () => workerSpec(),
    resolveEngine: () => engine,
  });

  const result = await scheduler.claimAndRun();

  assert.ok(result);
  assert.equal(result.sessionId, 'worker-1');
  assert.equal(result.status, 'succeeded');
  assert.match(result.summary ?? '', /hello/i);

  // Check session status was updated
  const workerSession = await sessions.findById('worker-1');
  assert.equal(workerSession?.status, 'succeeded');

  // Check parent got child_session_completed
  const parentEvents = await events.list('orch-1');
  const completion = parentEvents.find(e => e.kind === 'child_session_completed');
  assert.ok(completion, 'expected child_session_completed on parent');
  assert.equal((completion!.payload as { childId: string }).childId, 'worker-1');
  assert.equal((completion!.payload as { status: string }).status, 'succeeded');

  await rm(tmpDir, { recursive: true, force: true });
});

test('WorkerScheduler invokes onWorkerComplete with the final status and summary', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  const workspaceManager = new WorkspaceManager({ baseDir: tmpDir });

  await sessions.create({
    id: 'worker-b1', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: 'board:v1:proj/x:task-42', agentSpecId: 'coding-default',
    metadata: { goal: 'Do the board task' },
  });

  const engine = new MockAgentEngine([{ finalMessage: 'Done the board work', finishReason: 'completed' }]);
  const calls: Array<{ id: string; status: string; summary?: string }> = [];
  const scheduler = new WorkerScheduler({
    sessions, bus, workspaceManager,
    resolveSpec: async () => workerSpec(),
    resolveEngine: () => engine,
    onWorkerComplete: (session, result) => { calls.push({ id: session.id, status: result.status, summary: result.summary }); },
  });

  await scheduler.claimAndRun();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.id, 'worker-b1');
  assert.equal(calls[0]?.status, 'succeeded');
  assert.match(calls[0]?.summary ?? '', /board work/i);

  await rm(tmpDir, { recursive: true, force: true });
});

test('WorkerScheduler returns null when no routing sessions exist', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  const workspaceManager = new WorkspaceManager({ baseDir: tmpDir });

  const scheduler = new WorkerScheduler({
    sessions, bus, workspaceManager,
    resolveSpec: async () => workerSpec(),
    resolveEngine: () => new MockAgentEngine([]),
  });

  const result = await scheduler.claimAndRun();
  assert.equal(result, null);

  await rm(tmpDir, { recursive: true, force: true });
});

test('WorkerScheduler claims atomically with a lease', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  const workspaceManager = new WorkspaceManager({ baseDir: tmpDir });

  await sessions.create({
    id: 'worker-lease', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: null, agentSpecId: 'coding-default', metadata: { goal: 'check lease' },
  });

  let observedLease: string | null | undefined;
  let observedStatus: string | undefined;
  const engine = new MockAgentEngine([]);
  engine.runTurn = async () => {
    const mid = await sessions.findById('worker-lease');
    observedLease = mid?.leaseExpiresAt;
    observedStatus = mid?.status;
    return { toolCalls: [], finalMessage: 'done', finishReason: 'completed' };
  };

  const scheduler = new WorkerScheduler({
    sessions, bus, workspaceManager,
    leaseMs: 60_000,
    resolveSpec: async () => workerSpec(),
    resolveEngine: () => engine,
  });

  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'succeeded');
  assert.equal(observedStatus, 'running');
  assert.ok(observedLease, 'expected a lease to be set during the run');
  assert.ok(new Date(observedLease!).getTime() > Date.now(), 'lease expires in the future');

  await rm(tmpDir, { recursive: true, force: true });
});

test('WorkerScheduler.reapExpiredLeases fails expired running sessions and notifies parent', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  const workspaceManager = new WorkspaceManager({ baseDir: tmpDir });

  await sessions.create({
    id: 'orch-3', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: 'linear:AGE-11', agentSpecId: 'orchestrator-supervisor', metadata: {},
  });
  await sessions.create({
    id: 'worker-crashed', actor: 'worker', parentSessionId: 'orch-3', status: 'routing',
    channelOrigin: 'linear:AGE-11', agentSpecId: 'coding-default', metadata: { goal: 'doomed' },
  });
  // Simulate a crashed claimer: claimed with a lease already in the past.
  const claimed = await sessions.claimNextRouting('worker', new Date(Date.now() - 1000).toISOString());
  assert.equal(claimed?.id, 'worker-crashed');

  const scheduler = new WorkerScheduler({
    sessions, bus, workspaceManager,
    resolveSpec: async () => workerSpec(),
    resolveEngine: () => new MockAgentEngine([]),
  });

  const reaped = await scheduler.reapExpiredLeases();
  assert.equal(reaped, 1);

  const session = await sessions.findById('worker-crashed');
  assert.equal(session?.status, 'failed');

  const parentEvents = await events.list('orch-3');
  const completion = parentEvents.find((e) => e.kind === 'child_session_completed');
  assert.ok(completion, 'parent must learn about the crashed child');
  assert.equal((completion!.payload as { status: string }).status, 'failed');
  assert.match((completion!.payload as { error: string }).error, /lease expired/i);

  // Idempotent: a second sweep finds nothing.
  assert.equal(await scheduler.reapExpiredLeases(), 0);

  await rm(tmpDir, { recursive: true, force: true });
});

test('WorkerScheduler fails a turn that exceeds turnTimeoutMs', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  const workspaceManager = new WorkspaceManager({ baseDir: tmpDir });

  await sessions.create({
    id: 'orch-4', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: null, agentSpecId: 'orchestrator-supervisor', metadata: {},
  });
  await sessions.create({
    id: 'worker-slow', actor: 'worker', parentSessionId: 'orch-4', status: 'routing',
    channelOrigin: null, agentSpecId: 'coding-default', metadata: { goal: 'too slow' },
  });

  // Well-behaved engine: settles with an aborted result when the signal fires
  // (mirrors engine adapter behavior).
  const engine = new MockAgentEngine([]);
  engine.runTurn = (input) => new Promise((resolve) => {
    input.signal.addEventListener('abort', () => resolve({
      toolCalls: [], finishReason: 'aborted', errorMessage: 'Engine run aborted',
    }));
  });

  const spec = workerSpec();
  spec.policies.turnTimeoutMs = 30;

  const scheduler = new WorkerScheduler({
    sessions, bus, workspaceManager,
    resolveSpec: async () => spec,
    resolveEngine: () => engine,
  });

  const result = await scheduler.claimAndRun();
  assert.ok(result);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /aborted/i);

  const session = await sessions.findById('worker-slow');
  assert.equal(session?.status, 'failed');

  await rm(tmpDir, { recursive: true, force: true });
});

test('WorkerScheduler marks session as failed when engine throws', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  const workspaceManager = new WorkspaceManager({ baseDir: tmpDir });

  await sessions.create({
    id: 'orch-2', actor: 'orchestrator', parentSessionId: null, status: 'open',
    channelOrigin: null, agentSpecId: 'orchestrator-supervisor', metadata: {},
  });
  await sessions.create({
    id: 'worker-2', actor: 'worker', parentSessionId: 'orch-2', status: 'routing',
    channelOrigin: null, agentSpecId: 'coding-default',
    metadata: { goal: 'Fail on purpose' },
  });

  const engine = new MockAgentEngine([
    { finishReason: 'error' },
  ]);
  // Override to throw
  engine.runTurn = async () => { throw new Error('engine crashed'); };

  const scheduler = new WorkerScheduler({
    sessions, bus, workspaceManager,
    resolveSpec: async () => workerSpec(),
    resolveEngine: () => engine,
  });

  const result = await scheduler.claimAndRun();

  assert.ok(result);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /engine crashed/);

  const workerSession = await sessions.findById('worker-2');
  assert.equal(workerSession?.status, 'failed');

  // Parent still gets notified
  const parentEvents = await events.list('orch-2');
  const completion = parentEvents.find(e => e.kind === 'child_session_completed');
  assert.ok(completion);
  assert.equal((completion!.payload as { status: string }).status, 'failed');

  await rm(tmpDir, { recursive: true, force: true });
});
