import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import { BoardChannelDriver } from '@remote-sandbox-agents/channels';
import {
  applyHandoff,
  effectiveHandoffStatus,
  parseHandoffJson,
  parseHandoffString,
  rewriteReviewerNeedsFixes,
  resolveHumanHandoffTarget,
  synthesizeFallbackHandoff,
} from './handoff.js';

// ----- parseHandoffJson -----

test('parseHandoffJson: returns null on non-object input', () => {
  assert.equal(parseHandoffJson(null), null);
  assert.equal(parseHandoffJson(undefined), null);
  assert.equal(parseHandoffJson('agent-reviewer'), null);
  assert.equal(parseHandoffJson(123), null);
  assert.equal(parseHandoffJson([]), null);
});

test('parseHandoffJson: parses the canonical shape (targetKind/targetId/status/message)', () => {
  const out = parseHandoffJson({
    targetKind: 'agent',
    targetId: 'agent-reviewer',
    status: 'review',
    message: 'ready for review',
  });
  assert.deepEqual(out, {
    targetKind: 'agent',
    targetId: 'agent-reviewer',
    status: 'review',
    message: 'ready for review',
  });
});

test('parseHandoffJson: accepts the shorthand kind/id aliases (agent-friendly)', () => {
  const out = parseHandoffJson({ kind: 'user', id: 'user-dev' });
  assert.deepEqual(out, { targetKind: 'user', targetId: 'user-dev' });
});

test('parseHandoffJson: rejects unknown targetKind', () => {
  assert.equal(parseHandoffJson({ targetKind: 'team', targetId: 'something' }), null);
});

test('parseHandoffJson: rejects empty targetId', () => {
  assert.equal(parseHandoffJson({ targetKind: 'agent', targetId: '' }), null);
});

test('parseHandoffJson: rejects unknown status values rather than coercing', () => {
  assert.equal(
    parseHandoffJson({ targetKind: 'agent', targetId: 'agent-coder', status: 'in_progress' }),
    null,
  );
});

test('parseHandoffJson: drops empty messages but accepts the rest', () => {
  const out = parseHandoffJson({ targetKind: 'agent', targetId: 'agent-coder', message: '' });
  assert.deepEqual(out, { targetKind: 'agent', targetId: 'agent-coder' });
});

// ----- parseHandoffString -----

test('parseHandoffString: parses valid JSON', () => {
  const out = parseHandoffString('{"targetKind":"agent","targetId":"agent-reviewer"}');
  assert.deepEqual(out, { targetKind: 'agent', targetId: 'agent-reviewer' });
});

test('parseHandoffString: returns null on malformed JSON (never throws)', () => {
  assert.equal(parseHandoffString('this is not json'), null);
  assert.equal(parseHandoffString(''), null);
});

// ----- applyHandoff -----

interface CaptureLogger {
  log(m: string): void;
  warn(m: string): void;
  entries: string[];
}
function captureLogger(): CaptureLogger {
  const entries: string[] = [];
  return {
    entries,
    log: (m) => entries.push(m),
    warn: (m) => entries.push(`WARN ${m}`),
  };
}

async function seedTaskAndAgents(): Promise<{ board: InMemoryBoardStore; taskId: string }> {
  const board = new InMemoryBoardStore();
  await board.upsertAgent({
    id: 'agent-coder',
    tenantId: 't1',
    projectId: 'p1',
    profileId: 'coder',
    displayName: 'Coder',
  });
  await board.upsertAgent({
    id: 'agent-reviewer',
    tenantId: 't1',
    projectId: 'p1',
    profileId: 'reviewer',
    displayName: 'Reviewer',
  });
  await board.upsertUser({
    id: 'user-dev',
    tenantId: 't1',
    projectId: 'p1',
    kind: 'human',
    displayName: 'Dev',
    externalRefs: {},
  });
  const task = await board.createTask({
    tenantId: 't1',
    projectId: 'p1',
    title: 'sample task',
    createdBy: 'user-dev',
  });
  await board.assignTask({
    taskId: task.id,
    assigneeKind: 'agent',
    assigneeId: 'agent-coder',
    assignedBy: 'user-dev',
  });
  return { board, taskId: task.id };
}

test('effectiveHandoffStatus: agent + review|omitted → triaging; user statuses honored', () => {
  assert.equal(
    effectiveHandoffStatus({ targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' }),
    'triaging',
  );
  assert.equal(
    effectiveHandoffStatus({ targetKind: 'agent', targetId: 'agent-reviewer' }),
    'triaging',
  );
  assert.equal(
    effectiveHandoffStatus({ targetKind: 'agent', targetId: 'agent-reviewer', status: 'done' }),
    'done',
  );
  assert.equal(
    effectiveHandoffStatus({ targetKind: 'user', targetId: 'user-dev', status: 'review' }),
    'review',
  );
  assert.equal(
    effectiveHandoffStatus({ targetKind: 'user', targetId: 'user-dev', status: 'done' }),
    'done',
  );
  assert.equal(
    effectiveHandoffStatus({ targetKind: 'user', targetId: 'user-dev' }),
    undefined,
  );
});

test('applyHandoff: reassigns from coder to reviewer and updates status', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  const logger = captureLogger();
  const result = await applyHandoff({
    taskId,
    intent: {
      targetKind: 'agent',
      targetId: 'agent-reviewer',
      status: 'review',
      message: 'ready for review',
    },
    by: 'agent-coder',
    board,
    logger,
  });
  assert.equal(result.applied, true);
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'agent-reviewer');
  assert.equal(after?.status, 'triaging', 'agent→agent must be poll-routable, not sit in review');
  const events = await board.taskEvents(taskId);
  assert.ok(
    events.some((e) => e.kind === 'reassigned' || e.kind === 'assigned'),
    'should write an assigned/reassigned task event',
  );
  assert.ok(
    events.some((e) => e.kind === 'commented' && typeof e.payload.text === 'string' && (e.payload.text as string).includes('ready for review')),
    'should write a comment containing the handoff message',
  );
  assert.ok(logger.entries.some((e) => e.startsWith('handoff.applied')));
});

test('applyHandoff: unknown principal degrades gracefully (logs, does not throw, does not change board)', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  const logger = captureLogger();
  const before = await board.getTask(taskId);
  const result = await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-ghost' },
    by: 'agent-coder',
    board,
    logger,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'principal-unknown');
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, before?.assigneeId);
  assert.equal(after?.status, before?.status);
  assert.ok(logger.entries.some((e) => e.startsWith('WARN handoff.principal_unknown')));
});

test('applyHandoff: task missing degrades gracefully', async () => {
  const { board } = await seedTaskAndAgents();
  const logger = captureLogger();
  const result = await applyHandoff({
    taskId: 'no-such-task',
    intent: { targetKind: 'agent', targetId: 'agent-reviewer' },
    by: 'agent-coder',
    board,
    logger,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'task-missing');
});

test('applyHandoff: idempotent no-op when task already at effective agent-handoff state', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await board.assignTask({
    taskId,
    assigneeKind: 'agent',
    assigneeId: 'agent-reviewer',
    assignedBy: 'user-dev',
  });
  await board.updateStatus({ taskId, status: 'triaging', by: 'agent-coder' });

  const eventsBefore = (await board.taskEvents(taskId)).length;
  const result = await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'no-op');
  const eventsAfter = (await board.taskEvents(taskId)).length;
  assert.equal(eventsAfter, eventsBefore, 'no-op handoff must not write events');
});

test('applyHandoff: agent targeting itself is redirected to fallbackHumanId (stops reviewer→reviewer loops)', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await board.assignTask({
    taskId,
    assigneeKind: 'agent',
    assigneeId: 'agent-reviewer',
    assignedBy: 'agent-coder',
  });
  await board.updateStatus({ taskId, status: 'working', by: 'agent-reviewer' });
  const logger = captureLogger();
  const result = await applyHandoff({
    taskId,
    intent: {
      targetKind: 'agent',
      targetId: 'agent-reviewer',
      status: 'review',
      message: 'PASS — README note looks good',
    },
    by: 'agent-reviewer',
    board,
    logger,
    fallbackHumanId: 'user-dev',
  });
  assert.equal(result.applied, true);
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'user-dev');
  assert.equal(after?.assigneeKind, 'user');
  assert.equal(after?.status, 'review', 'human target must sit in review, not triaging');
  assert.ok(logger.entries.some((e) => e.includes('handoff.self_redirect')));
});

test('applyHandoff: profile id by=reviewer targeting agent-reviewer is still a self-handoff', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await board.assignTask({
    taskId,
    assigneeKind: 'agent',
    assigneeId: 'agent-reviewer',
    assignedBy: 'agent-coder',
  });
  await board.updateStatus({ taskId, status: 'working', by: 'reviewer' });
  const result = await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'reviewer',
    board,
    logger: captureLogger(),
    fallbackHumanId: 'user-dev',
  });
  assert.equal(result.applied, true);
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'user-dev');
  assert.equal(after?.status, 'review');
});

test('applyHandoff: self-handoff falls back to the user who raised the task, not autobounce env', async () => {
  const board = new InMemoryBoardStore();
  await board.upsertAgent({
    id: 'agent-reviewer',
    tenantId: 't1',
    projectId: 'p1',
    profileId: 'reviewer',
    displayName: 'Reviewer',
  });
  await board.upsertUser({
    id: 'user-raiser',
    tenantId: 't1',
    projectId: 'p1',
    kind: 'human',
    displayName: 'Raiser',
    externalRefs: {},
  });
  await board.upsertUser({
    id: 'user-dev',
    tenantId: 't1',
    projectId: 'p1',
    kind: 'human',
    displayName: 'Dev',
    externalRefs: {},
  });
  const task = await board.createTask({
    tenantId: 't1',
    projectId: 'p1',
    title: 'raised by someone else',
    createdBy: 'user-raiser',
  });
  await board.assignTask({
    taskId: task.id,
    assigneeKind: 'agent',
    assigneeId: 'agent-reviewer',
    assignedBy: 'user-raiser',
  });
  await board.updateStatus({ taskId: task.id, status: 'working', by: 'reviewer' });
  const result = await applyHandoff({
    taskId: task.id,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'reviewer',
    board,
    logger: captureLogger(),
    fallbackHumanId: 'user-dev',
  });
  assert.equal(result.applied, true);
  const after = await board.getTask(task.id);
  assert.equal(after?.assigneeId, 'user-raiser', 'raiser owns the fallback, not REMOTE_AGENT_AUTOBOUNCE_HUMAN');
  assert.equal(after?.assigneeKind, 'user');
  assert.equal(after?.status, 'review');
});

test('applyHandoff: self-handoff without autobounce still falls back to the raiser', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await board.assignTask({
    taskId,
    assigneeKind: 'agent',
    assigneeId: 'agent-reviewer',
    assignedBy: 'agent-coder',
  });
  await board.updateStatus({ taskId, status: 'working', by: 'agent-reviewer' });
  await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-reviewer',
    board,
    logger: captureLogger(),
  });
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'user-dev', 'createdBy is the default fallback');
  assert.equal(after?.status, 'review');
});

test('applyHandoff: self-handoff with unknown raiser and no fallbackHumanId parks in review', async () => {
  const board = new InMemoryBoardStore();
  await board.upsertAgent({
    id: 'agent-reviewer',
    tenantId: 't1',
    projectId: 'p1',
    profileId: 'reviewer',
    displayName: 'Reviewer',
  });
  const task = await board.createTask({
    tenantId: 't1',
    projectId: 'p1',
    title: 'ghost raiser',
    createdBy: 'user-ghost',
  });
  await board.assignTask({
    taskId: task.id,
    assigneeKind: 'agent',
    assigneeId: 'agent-reviewer',
    assignedBy: 'user-ghost',
  });
  await board.updateStatus({ taskId: task.id, status: 'working', by: 'agent-reviewer' });
  await applyHandoff({
    taskId: task.id,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-reviewer',
    board,
    logger: captureLogger(),
  });
  const after = await board.getTask(task.id);
  assert.equal(after?.assigneeId, 'agent-reviewer');
  assert.equal(after?.status, 'review', 'must not coerce self-handoff to triaging');
});

test('applyHandoff: agent target with omitted status still lands in triaging', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await board.updateStatus({ taskId, status: 'working', by: 'system' });
  await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
  });
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'agent-reviewer');
  assert.equal(after?.status, 'triaging');
});

test('applyHandoff: human target with status=review stays in review (no worker)', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await applyHandoff({
    taskId,
    intent: {
      targetKind: 'user',
      targetId: 'user-dev',
      status: 'review',
      message: 'operator can take it from here',
    },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
  });
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'user-dev');
  assert.equal(after?.status, 'review');
});

test('applyHandoff: agent→agent review handoff is picked up by the control poller', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await applyHandoff({
    taskId,
    intent: {
      targetKind: 'agent',
      targetId: 'agent-reviewer',
      status: 'review',
      message: 'please review',
    },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
  });
  const routed: string[] = [];
  const driver = new BoardChannelDriver({
    board,
    route: async (id) => {
      routed.push(id);
      return { routed: true };
    },
  });
  const poll = await driver.pollOnce();
  assert.deepEqual(routed, [taskId]);
  assert.deepEqual(poll.routed, [taskId]);
});

test('applyHandoff: human handoff with status=done and message', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await applyHandoff({
    taskId,
    intent: {
      targetKind: 'user',
      targetId: 'user-dev',
      status: 'done',
      message: 'review passed, all checks green',
    },
    by: 'agent-reviewer',
    board,
    logger: captureLogger(),
  });
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'user-dev');
  assert.equal(after?.status, 'done');
});

// ----- handoff context propagation (snapshot + summary + message → task metadata) -----

test('applyHandoff: stamps handoffContext on task.metadata so the next session can hydrate', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  const snapshotRef = { id: 'snap-abc-123', mediaType: 'application/x-tar' };
  await applyHandoff({
    taskId,
    intent: {
      targetKind: 'agent',
      targetId: 'agent-reviewer',
      status: 'review',
      message: 'focus the review on the new auth guard in src/api/auth.ts',
    },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    snapshotRef,
    summary:
      'Added auth guard to /api/users/:id; covered with two new unit tests; ran npm test (passed).',
  });
  const after = await board.getTask(taskId);
  const ctx = after?.metadata.handoffContext as Record<string, unknown> | undefined;
  assert.ok(ctx, 'handoffContext must be persisted on the task');
  assert.equal(ctx.fromAgentId, 'agent-coder');
  assert.equal(ctx.toAgentId, 'agent-reviewer');
  assert.deepEqual(ctx.snapshotRef, snapshotRef);
  assert.equal(ctx.restoreWorkspaceUri, null);
  assert.match(ctx.summary as string, /Added auth guard/);
  assert.match(ctx.message as string, /focus the review/);
  assert.ok(typeof ctx.appliedAt === 'string' && (ctx.appliedAt as string).length > 0);
});

test('applyHandoff: comments artifact links and stamps handoffContext.artifacts', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  const snapshotRef = { type: 'local', id: 'snap-art-1', location: '/tmp/snaps/snap-art-1' };
  await applyHandoff({
    taskId,
    intent: {
      targetKind: 'agent',
      targetId: 'agent-reviewer',
      status: 'review',
      message: 'paper ready',
    },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    snapshotRef,
    artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true }],
  });
  const after = await board.getTask(taskId);
  const ctx = after?.metadata.handoffContext as Record<string, unknown> | undefined;
  const arts = ctx?.artifacts as Array<{ path: string }> | undefined;
  assert.equal(arts?.[0]?.path, 'artifacts/paper.md');
  const events = await board.taskEvents(taskId);
  const texts = events.filter((e) => e.kind === 'commented').map((e) => String(e.payload.text ?? ''));
  assert.ok(texts.some((t) => t.includes('Paper') || t.includes('artifacts/paper.md')));
});

test('applyHandoff: dropped artifacts get their own comment', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    artifactDrops: [{ path: 'repo/x', reason: 'not_under_artifacts' }],
  });
  const events = await board.taskEvents(taskId);
  const texts = events.filter((e) => e.kind === 'commented').map((e) => String(e.payload.text ?? ''));
  assert.ok(texts.some((t) => t.includes('Dropped invalid artifact')));
});

test('applyHandoff: stamps restoreWorkspaceUri from an S3 snapshotRef', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  const snapshotRef = { type: 'local', id: 'snap-s3-1', location: '/tmp/snapshots/snap-s3-1' };
  await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    snapshotRef,
  });
  const after = await board.getTask(taskId);
  const ctx = after?.metadata.handoffContext as Record<string, unknown> | undefined;
  assert.equal(ctx?.restoreWorkspaceUri, '/tmp/snapshots/snap-s3-1/workspace.tar');
  assert.deepEqual(ctx?.snapshotRef, snapshotRef);
});

test('applyHandoff: does NOT stamp handoffContext when the handoff is a no-op (idempotent)', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await board.assignTask({
    taskId,
    assigneeKind: 'agent',
    assigneeId: 'agent-reviewer',
    assignedBy: 'user-dev',
  });
  await board.updateStatus({ taskId, status: 'triaging', by: 'agent-coder' });

  await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    snapshotRef: { id: 'snap-stale' },
    summary: 'stale summary should not be persisted on a no-op',
  });
  const after = await board.getTask(taskId);
  assert.equal(after?.metadata.handoffContext, undefined, 'no-op handoff must not stamp context');
});

// ----- synthesizeFallbackHandoff: autobounce when agent forgot to call handoff -----

test('synthesizeFallbackHandoff: returns a human-targeted review intent for a succeeded run', () => {
  const intent = synthesizeFallbackHandoff({
    workerStatus: 'succeeded',
    workerSummary: 'Worker completed the task.',
    fromAgentId: 'agent-coder',
    fallbackHuman: 'user-dev',
  });
  assert.ok(intent, 'must produce an intent for succeeded + configured human');
  assert.equal(intent!.targetKind, 'user');
  assert.equal(intent!.targetId, 'user-dev');
  assert.equal(intent!.status, 'review');
  assert.match(intent!.message ?? '', /\[autobounce\]/);
  assert.match(intent!.message ?? '', /agent-coder/);
  assert.match(intent!.message ?? '', /Worker completed the task/);
});

test('synthesizeFallbackHandoff: returns null for a failed run (operators must triage failures explicitly)', () => {
  const intent = synthesizeFallbackHandoff({
    workerStatus: 'failed',
    workerSummary: 'pi-runner exited 1',
    fromAgentId: 'agent-coder',
    fallbackHuman: 'user-dev',
  });
  assert.equal(intent, null, 'failed runs must NOT auto-route — operator triage only');
});

test('synthesizeFallbackHandoff: returns null when no fallback human is configured (autobounce disabled)', () => {
  assert.equal(
    synthesizeFallbackHandoff({
      workerStatus: 'succeeded',
      workerSummary: 'ok',
      fromAgentId: 'agent-coder',
      fallbackHuman: undefined,
    }),
    null,
  );
  assert.equal(
    synthesizeFallbackHandoff({
      workerStatus: 'succeeded',
      workerSummary: 'ok',
      fromAgentId: 'agent-coder',
      fallbackHuman: '',
    }),
    null,
  );
});

test('synthesizeFallbackHandoff: handles missing/empty summary without producing garbage', () => {
  const intent = synthesizeFallbackHandoff({
    workerStatus: 'succeeded',
    fromAgentId: 'agent-coder',
    fallbackHuman: 'user-dev',
  });
  assert.ok(intent);
  // No `Worker summary:` snippet when there's nothing to quote.
  assert.doesNotMatch(intent!.message ?? '', /Worker summary:/);
  assert.match(intent!.message ?? '', /\[autobounce\]/);
});

test('synthesizeFallbackHandoff: truncates very long summaries to keep the message bounded', () => {
  const longSummary = 'x'.repeat(5000);
  const intent = synthesizeFallbackHandoff({
    workerStatus: 'succeeded',
    workerSummary: longSummary,
    fromAgentId: 'agent-coder',
    fallbackHuman: 'user-dev',
  });
  assert.ok(intent);
  // Generous upper bound: prefix + 240-char snippet + suffix should never blow past ~800.
  assert.ok((intent!.message ?? '').length < 800, `message too long: ${(intent!.message ?? '').length}`);
});

test('applyHandoff: round-trips the synthesized autobounce intent end-to-end against the board', async () => {
  // This is the contract that protects against the 2026-06-29 silent-stall:
  // when a coder run succeeds but the model never called `handoff`, the
  // harness uses `synthesizeFallbackHandoff` + `applyHandoff` to reroute
  // the task to the configured human with a clear [autobounce] message.
  const { board, taskId } = await seedTaskAndAgents();
  const intent = synthesizeFallbackHandoff({
    workerStatus: 'succeeded',
    workerSummary: 'Worker completed the task.',
    fromAgentId: 'agent-coder',
    fallbackHuman: 'user-dev',
  });
  assert.ok(intent);
  const result = await applyHandoff({
    taskId,
    intent: intent!,
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    snapshotRef: { id: 'snap-autobounce-1' },
    summary: 'Worker completed the task.',
  });
  assert.equal(result.applied, true);
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'user-dev');
  assert.equal(after?.status, 'review');
  // The autobounce message must show up on the board so the operator can see why.
  const events = await board.taskEvents(taskId);
  assert.ok(
    events.some(
      (e) =>
        e.kind === 'commented' &&
        typeof e.payload.text === 'string' &&
        (e.payload.text as string).includes('[autobounce]'),
    ),
    'autobounce must leave a board comment marked [autobounce]',
  );
  // Handoff context must still propagate so a manual "re-assign to agent-coder"
  // hydrates the same workspace + carries the prior summary.
  const ctx = after?.metadata.handoffContext as Record<string, unknown> | undefined;
  assert.ok(ctx, 'autobounce must still stamp handoffContext');
  assert.equal(ctx.fromAgentId, 'agent-coder');
  assert.equal(ctx.toAgentId, 'user-dev');
  assert.deepEqual(ctx.snapshotRef, { id: 'snap-autobounce-1' });
});

test('applyHandoff: handoffContext omits snapshotRef + summary when caller does not provide them', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    // no snapshotRef, no summary
  });
  const after = await board.getTask(taskId);
  const ctx = after?.metadata.handoffContext as Record<string, unknown> | undefined;
  assert.ok(ctx, 'handoffContext should still be persisted for downstream visibility');
  assert.equal(ctx.snapshotRef, null);
  assert.equal(ctx.summary, null);
});

test('resolveHumanHandoffTarget maps user aliases to the raiser', () => {
  const out = resolveHumanHandoffTarget(
    { targetKind: 'user', targetId: 'user', status: 'review' },
    'user-dev',
  );
  assert.equal(out.targetId, 'user-dev');
});

test('rewriteReviewerNeedsFixes: reviewer human target becomes coder', () => {
  const out = rewriteReviewerNeedsFixes(
    { targetKind: 'user', targetId: 'user-dev', status: 'review', message: 'NEEDS FIXES — missing test' },
    'reviewer',
  );
  assert.equal(out.targetKind, 'agent');
  assert.equal(out.targetId, 'agent-coder');
});

test('applyHandoff: cycle cap redirects further agent bounces to a human', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  const first = await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
    cycleCap: 1,
  });
  assert.equal(first.applied, true);
  assert.equal(first.resolvedTargetKind, 'agent');
  const second = await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-coder', status: 'review' },
    by: 'agent-reviewer',
    board,
    logger: captureLogger(),
    cycleCap: 1,
  });
  assert.equal(second.applied, true);
  assert.equal(second.resolvedTargetKind, 'user');
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'user-dev');
  assert.equal(after?.metadata.handoffBounceCount, 2);
});

test('applyHandoff: reviewer NEEDS FIXES routes to coder', async () => {
  const { board, taskId } = await seedTaskAndAgents();
  await applyHandoff({
    taskId,
    intent: { targetKind: 'agent', targetId: 'agent-reviewer' },
    by: 'agent-coder',
    board,
    logger: captureLogger(),
  });
  const result = await applyHandoff({
    taskId,
    intent: {
      targetKind: 'user',
      targetId: 'user-dev',
      status: 'review',
      message: 'NEEDS FIXES — add a unit test',
    },
    by: 'agent-reviewer',
    board,
    logger: captureLogger(),
  });
  assert.equal(result.applied, true);
  assert.equal(result.resolvedTargetKind, 'agent');
  assert.equal(result.resolvedTargetId, 'agent-coder');
  const after = await board.getTask(taskId);
  assert.equal(after?.assigneeId, 'agent-coder');
  assert.equal(after?.status, 'triaging');
});
