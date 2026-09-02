import type { SessionRecord } from '@remote-sandbox-agents/contracts';
import { parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import type { BoardAssignmentRouter } from '@remote-sandbox-agents/orchestrator';
import type { BoardStore, SessionsRepo } from '@remote-sandbox-agents/persistence';
import type { SnapshotRef } from '@remote-sandbox-agents/sandbox';
import { applyHandoff, parseHandoffJson, synthesizeFallbackHandoff } from '../wiring/handoff.js';
import { postWorkerSummary } from '../wiring/board-status-back.js';
import { formatFailureSummary } from '../wiring/format-failure-summary.js';
import { captureMrRequest, parseMrRequestJson } from '../wiring/mr-request.js';
import type { ArtifactDrop, CapturedArtifact } from '../wiring/artifacts.js';

export interface WorkerCompletionPayload {
  status: 'succeeded' | 'failed';
  summary?: string;
  error?: string;
  handoff?: unknown;
  mrRequest?: unknown;
  artifacts?: CapturedArtifact[];
  artifactDrops?: ArtifactDrop[];
  snapshotRef?: SnapshotRef | null;
  agentRunId?: string;
}

export async function recordWorkerCompletion(
  sessions: SessionsRepo,
  session: SessionRecord,
  result: WorkerCompletionPayload,
): Promise<void> {
  await sessions.mergeMetadata(session.id, { completionPending: result });
}

export async function projectPendingCompletions(opts: {
  board: BoardStore;
  sessions: SessionsRepo;
  router: BoardAssignmentRouter;
  autobounceHuman?: string;
}): Promise<number> {
  const pending = await opts.sessions.listPendingCompletion();
  let projected = 0;
  for (const session of pending) {
    const payload = session.metadata.completionPending as WorkerCompletionPayload | undefined;
    if (!payload) continue;
    await projectWorkerCompletion({
      board: opts.board,
      sessions: opts.sessions,
      router: opts.router,
      session,
      result: payload,
      autobounceHuman: opts.autobounceHuman,
    });
    projected += 1;
  }
  return projected;
}

export async function projectWorkerCompletion(opts: {
  board: BoardStore;
  sessions: SessionsRepo;
  router: BoardAssignmentRouter;
  session: SessionRecord;
  result: WorkerCompletionPayload;
  autobounceHuman?: string;
}): Promise<void> {
  const { board, sessions, router, session, result, autobounceHuman } = opts;
  if (session.metadata.completionProjectedAt) return;

  const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
  if (!parsed) {
    await sessions.mergeMetadata(session.id, { completionProjectedAt: new Date().toISOString() });
    return;
  }
  const link = { taskId: parsed.taskId, by: session.agentSpecId };
  const summary =
    result.status === 'failed'
      ? formatFailureSummary(result.summary, result.error)
      : result.summary ?? '';
  await postWorkerSummary(board, {
    taskId: link.taskId,
    status: result.status,
    summary,
    by: link.by,
  });

  if (result.status === 'succeeded' && result.mrRequest != null) {
    const parsedMr = parseMrRequestJson(result.mrRequest);
    if (parsedMr) {
      await captureMrRequest({
        taskId: link.taskId,
        intent: parsedMr,
        fromAgentId: link.by,
        sessionId: session.id,
        agentRunId: result.agentRunId,
        snapshotRef: result.snapshotRef ?? null,
        board,
      }).catch(() => {});
    }
  }

  if (result.status === 'succeeded') {
    let intent = result.handoff != null ? parseHandoffJson(result.handoff) : null;
    if (intent == null) {
      intent = synthesizeFallbackHandoff({
        workerStatus: result.status,
        workerSummary: summary,
        fromAgentId: link.by,
        fallbackHuman: autobounceHuman,
      });
    }
    if (intent) {
      const applied = await applyHandoff({
        taskId: link.taskId,
        intent,
        by: link.by,
        board,
        snapshotRef: result.snapshotRef,
        summary,
        fallbackHumanId: autobounceHuman,
        artifacts: result.artifacts,
        artifactDrops: result.artifactDrops,
      });
      if (applied.applied && applied.resolvedTargetKind === 'agent') {
        await router.route(link.taskId).catch(() => {});
      }
    }
  }

  await sessions.mergeMetadata(session.id, {
    completionProjectedAt: new Date().toISOString(),
  });
}
