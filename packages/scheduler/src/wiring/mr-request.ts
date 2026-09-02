/**
 * Agent → harness MR promotion request. When a worker calls the `request_mr`
 * Pi tool it writes `.agent/mr-request.json`. The runtime template collects
 * the sidecar; this module validates and stamps `task.metadata.mrRequest` for
 * operator approval. Promotion produces local git artifacts (`git-artifact-promotion.ts`).
 */

import type { BoardStore } from '@remote-sandbox-agents/persistence';

export type MrRequestStatus =
  | 'pending_approval'
  | 'blocked'
  | 'opened'
  | 'failed'
  | 'rejected';

/** Parsed agent intent (after validation). */
export interface MrRequestIntent {
  title: string;
  summary: string;
  /** Advisory — harness clamps to repo policy on promotion. */
  targetBranch: string;
  draft: boolean;
  handoffTo?: string;
}

/** Durable task.metadata.mrRequest shape. */
export interface TaskMrRequestRecord {
  status: MrRequestStatus;
  fromAgentId: string;
  sessionId: string;
  agentRunId?: string;
  snapshotRef: unknown | null;
  title: string;
  summary: string;
  targetBranch: string;
  draft: boolean;
  handoffTo?: string;
  createdAt: string;
  /** Filled after harness promotion. */
  mrUrl?: string;
  mrIid?: number;
  sourceBranch?: string;
  pushedCommitSha?: string;
  openedAt?: string;
  error?: string;
  rejectedAt?: string;
  /** Host path to `changes.patch` after approve. */
  patchArtifact?: string;
  /** Host path to `branch.bundle` after approve. */
  bundleArtifact?: string;
}

export function parseMrRequestJson(value: unknown): MrRequestIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const title = obj.title;
  const summary = obj.summary ?? obj.description;
  if (typeof title !== 'string' || title.trim().length === 0) return null;
  if (typeof summary !== 'string' || summary.trim().length === 0) return null;

  const targetBranch =
    typeof obj.targetBranch === 'string' && obj.targetBranch.length > 0
      ? obj.targetBranch
      : 'main';
  const draft = obj.draft === undefined ? true : Boolean(obj.draft);

  const out: MrRequestIntent = {
    title: title.trim(),
    summary: summary.trim(),
    targetBranch,
    draft,
  };
  if (typeof obj.handoffTo === 'string' && obj.handoffTo.length > 0) {
    out.handoffTo = obj.handoffTo;
  }
  return out;
}

export function parseMrRequestString(raw: string): MrRequestIntent | null {
  try {
    return parseMrRequestJson(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Strip control chars and collapse whitespace for MR body text. */
export function sanitizeMrSummary(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
}

export interface CaptureMrRequestOptions {
  taskId: string;
  intent: MrRequestIntent;
  fromAgentId: string;
  sessionId: string;
  agentRunId?: string;
  snapshotRef: unknown | null;
  board: Pick<BoardStore, 'getTask' | 'mergeTaskMetadata' | 'comment'>;
  logger?: { log(message: string): void; warn(message: string): void };
  clock?: () => string;
}

export interface CaptureMrRequestResult {
  captured: boolean;
  reason?: 'task-missing' | 'no-snapshot';
}

export async function captureMrRequest(opts: CaptureMrRequestOptions): Promise<CaptureMrRequestResult> {
  const logger = opts.logger ?? {
    log: (m) => process.stdout.write(`${m}\n`),
    warn: (m) => process.stderr.write(`${m}\n`),
  };
  const task = await opts.board.getTask(opts.taskId);
  if (!task) {
    logger.warn(`mr_request.task_missing taskId=${opts.taskId}`);
    return { captured: false, reason: 'task-missing' };
  }

  const status: MrRequestStatus = opts.snapshotRef ? 'pending_approval' : 'blocked';
  const record: TaskMrRequestRecord = {
    status,
    fromAgentId: opts.fromAgentId,
    sessionId: opts.sessionId,
    ...(opts.agentRunId ? { agentRunId: opts.agentRunId } : {}),
    snapshotRef: opts.snapshotRef,
    title: opts.intent.title,
    summary: sanitizeMrSummary(opts.intent.summary),
    targetBranch: opts.intent.targetBranch,
    draft: opts.intent.draft,
    ...(opts.intent.handoffTo ? { handoffTo: opts.intent.handoffTo } : {}),
    createdAt: (opts.clock ?? (() => new Date().toISOString()))(),
  };

  await opts.board.mergeTaskMetadata({
    taskId: opts.taskId,
    patch: { mrRequest: record as unknown as Record<string, unknown> },
  });

  const comment =
    status === 'pending_approval'
      ? `Agent requested draft MR: ${opts.intent.title}. Awaiting approval.`
      : `Agent requested MR "${opts.intent.title}" but no snapshot exists — request blocked until a checkpoint is available.`;
  await opts.board.comment({ taskId: opts.taskId, by: opts.fromAgentId, text: comment });

  logger.log(`mr_request.captured taskId=${opts.taskId} status=${status} title=${opts.intent.title}`);
  if (!opts.snapshotRef) return { captured: true, reason: 'no-snapshot' };
  return { captured: true };
}

export function readTaskMrRequest(metadata: Record<string, unknown> | undefined): TaskMrRequestRecord | null {
  const raw = metadata?.mrRequest;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as TaskMrRequestRecord;
}
