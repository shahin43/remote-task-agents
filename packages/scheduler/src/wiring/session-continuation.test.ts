import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemorySessionsRepo,
  InMemorySessionEventsRepo,
  InMemoryAgentBus,
} from '@remote-sandbox-agents/persistence';
import { SessionContinuationService } from './session-continuation.js';

function makeSvc() {
  const sessions = new InMemorySessionsRepo();
  const sessionEvents = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(sessionEvents);
  const svc = new SessionContinuationService({ sessions, sessionEvents, bus });
  return { sessions, sessionEvents, bus, svc };
}

test('continue reopens a terminal session to routing and appends channel.input', async () => {
  const { sessions, bus, svc } = makeSvc();
  const origin = 'board:v1:sample/service:task-1';
  await sessions.create({
    id: 's1', actor: 'worker', parentSessionId: null, status: 'succeeded',
    channelOrigin: origin, agentSpecId: 'pi-reviewer-default',
    metadata: { attemptNumber: 1, lastSnapshotRef: { id: 'snap-1' } },
  });

  const result = await svc.continue({ channelOrigin: origin, text: 'also fix the typo', actor: 'agent-coder', trigger: 'api' });

  assert.equal(result.reopened, true);
  assert.equal(result.sessionId, 's1');
  const reloaded = await sessions.findById('s1');
  assert.equal(reloaded!.status, 'routing');
  assert.equal(reloaded!.metadata.attemptNumber, 2);
  assert.equal(reloaded!.metadata.resumeSnapshotRef ?? null, null);

  const events = [];
  for await (const e of bus.replay('s1')) events.push(e);
  const inputs = events.filter((e) => e.kind === 'channel.input');
  assert.equal(inputs.length, 1);
  assert.equal((inputs[0]!.payload as { text: string }).text, 'also fix the typo');
});

test('continue injects run.summary when a prior worker_end exists', async () => {
  const { sessions, sessionEvents, bus, svc } = makeSvc();
  const origin = 'board:v1:sample/service:task-summary';
  await sessions.create({
    id: 's-summary', actor: 'worker', parentSessionId: null, status: 'succeeded',
    channelOrigin: origin, agentSpecId: 'pi-reviewer-default',
    metadata: { attemptNumber: 1, lastSnapshotRef: { type: 'local', id: 'snap-1', location: '/snaps/snap-1' } },
  });
  await sessionEvents.append({
    sessionId: 's-summary',
    eventType: 'turn',
    kind: 'worker_end',
    payload: { status: 'succeeded', summary: 'Updated README', durationMs: 1000, snapshotRef: { type: 'local', id: 'snap-1', location: '/snaps/snap-1' } },
  });

  await svc.continue({ channelOrigin: origin, text: 'follow up', actor: 'op', trigger: 'api' });

  const events = [];
  for await (const e of bus.replay('s-summary')) events.push(e);
  const summaries = events.filter((e) => e.kind === 'run.summary');
  assert.equal(summaries.length, 1);
  assert.match(String((summaries[0]!.payload as { text: string }).text), /Prior run \(attempt 1\)/);
  assert.match(String((summaries[0]!.payload as { text: string }).text), /Updated README/);
});

test('continue with resumeWorkspace stamps the prior lastSnapshotRef', async () => {
  const { sessions, svc } = makeSvc();
  const origin = 'board:v1:sample/service:task-2';
  await sessions.create({
    id: 's2', actor: 'worker', parentSessionId: null, status: 'failed',
    channelOrigin: origin, agentSpecId: 'pi-reviewer-default',
    metadata: { lastSnapshotRef: { id: 'snap-2', location: '/snaps/snap-2' } },
  });
  await svc.continue({ channelOrigin: origin, text: 'continue', actor: 'op', resumeWorkspace: true, trigger: 'api' });
  const reloaded = await sessions.findById('s2');
  assert.deepEqual(reloaded!.metadata.resumeSnapshotRef, { id: 'snap-2', location: '/snaps/snap-2' });
});

test('continue throws when no session exists for the channel origin', async () => {
  const { svc } = makeSvc();
  await assert.rejects(
    svc.continue({ channelOrigin: 'board:v1:p:none', text: 'x', actor: 'op', trigger: 'api' }),
    /no session/i,
  );
});

test('continue rejects follow-up while the session is still running', async () => {
  const { sessions, svc } = makeSvc();
  const origin = 'board:v1:sample/service:task-busy';
  await sessions.create({
    id: 's-busy', actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin: origin, agentSpecId: 'pi-reviewer-default',
    metadata: { attemptNumber: 2 },
  });
  await assert.rejects(
    svc.continue({ channelOrigin: origin, text: 'another follow-up', actor: 'op', trigger: 'api' }),
    /is running/i,
  );
  const reloaded = await sessions.findById('s-busy');
  assert.equal(reloaded!.status, 'running');
});

test('continue reopens a terminal session and clears closedAt', async () => {
  const { sessions, svc } = makeSvc();
  const origin = 'board:v1:sample/service:task-reopen';
  await sessions.create({
    id: 's-reopen', actor: 'worker', parentSessionId: null, status: 'succeeded',
    channelOrigin: origin, agentSpecId: 'pi-reviewer-default',
    metadata: { attemptNumber: 1 },
  });
  await sessions.updateStatus('s-reopen', 'succeeded');
  assert.ok((await sessions.findById('s-reopen'))!.closedAt);

  await svc.continue({ channelOrigin: origin, text: 'continue', actor: 'op', trigger: 'api' });

  const reloaded = await sessions.findById('s-reopen');
  assert.equal(reloaded!.status, 'routing');
  assert.equal(reloaded!.closedAt, null);
  assert.equal(reloaded!.leaseExpiresAt, null);
  assert.equal(reloaded!.metadata.attemptNumber, 2);
});
