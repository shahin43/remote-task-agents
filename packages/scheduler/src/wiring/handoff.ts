/**
 * Agent → harness handoff. When a worker (Pi runner inside the sandbox)
 * wants to pass the board task to another agent or to a human, it writes
 * `.agent/handoff.json` to its workspace via the `handoff` Pi tool. The
 * runtime template's `collect()` reads the raw JSON; this module parses,
 * validates, and applies it against the board after the run completes.
 *
 * The agent never touches the BoardStore directly — the runner is inside
 * a Docker sandbox with no network. Keeping the agent on the
 * "edit the workspace" side and the harness on the "external side
 * effects" side preserves the security boundary documented in CLAUDE.md.
 *
 * Robustness: every applier branch is logged; unknown principals are
 * left as-is so the operator can step in. Bad JSON does NOT fail the
 * run — the task simply reaches `review` with no auto-reassignment,
 * matching pre-handoff behavior. Agent-to-agent targets that request
 * `review` are coerced to `triaging` so the control poll / worker hook
 * can open the next session.
 */

import type { AssigneeKind, TaskStatus } from '@remote-sandbox-agents/contracts';
import type { BoardStore } from '@remote-sandbox-agents/persistence';
import { encodeSnapshotRef, workspaceTarUri, type SnapshotRef } from '@remote-sandbox-agents/sandbox';
import type { ArtifactDrop, CapturedArtifact } from './artifacts.js';

/**
 * Strict, validated handoff intent (after parsing). Used by `applyHandoff`.
 */
export interface HandoffIntent {
  /** Whom to reassign to. */
  targetKind: AssigneeKind;
  /** Board principal id, e.g. `agent-reviewer` or `user-dev`. */
  targetId: string;
  /**
   * Optional board status to set alongside the reassignment. When omitted
   * the existing status-back behavior wins (succeeded → review).
   */
  status?: TaskStatus;
  /** Optional note included on the board as a comment. */
  message?: string;
}

/**
 * What the assignment router needs to know about the previous agent's
 * run when it opens the next session for a handoff target. Persisted on
 * `BoardTask.metadata.handoffContext` so the data survives the gap
 * between worker-completion and the next route() call.
 */
export interface HandoffContext {
  fromAgentId: string;
  toAgentId: string;
  /** Snapshot to hydrate the next sandbox with. Null when the source agent had no snapshot. */
  snapshotRef: unknown | null;
  /**
   * Canonical workspace.tar pointer for the next worker restore.
   * S3: `file snapshot workspace.tar`. Local: host path to the tar.
   */
  restoreWorkspaceUri?: string | null;
  /** worker_summary text from the source agent. Null when omitted. */
  summary: string | null;
  /** The source agent's optional handoff note. */
  message?: string;
  /** ISO timestamp the handoff applier stamped this context. */
  appliedAt: string;
  /** Validated deliverables from this run, for the task drawer / next agent. */
  artifacts?: CapturedArtifact[];
}

function restoreUriFromSnapshotRef(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const rec = ref as Partial<SnapshotRef>;
  if (typeof rec.location !== 'string' || rec.location.length === 0) return null;
  return workspaceTarUri({ type: rec.type ?? '', location: rec.location });
}

function encodedSnapshotRef(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const rec = ref as { type?: unknown; id?: unknown };
  if (typeof rec.type !== 'string' || typeof rec.id !== 'string' || rec.id.length === 0) return null;
  try {
    return encodeSnapshotRef(ref as SnapshotRef);
  } catch {
    return null;
  }
}

function artifactLinkLines(artifacts: CapturedArtifact[] | undefined, snapshotRef: unknown): string[] {
  if (!artifacts || artifacts.length === 0) return [];
  const encoded = encodedSnapshotRef(snapshotRef);
  return artifacts.map((a) => {
    if (encoded) {
      const href = `/api/snapshots/${encodeURIComponent(encoded)}/file?path=${encodeURIComponent(a.path)}`;
      return `- [${a.title}](${href})`;
    }
    return `- \`${a.path}\``;
  });
}

async function commentArtifactsAndDrops(opts: {
  board: ApplyHandoffOptions['board'];
  taskId: string;
  by: string;
  artifacts?: CapturedArtifact[];
  artifactDrops?: ArtifactDrop[];
  snapshotRef?: unknown;
}): Promise<void> {
  if (opts.artifactDrops && opts.artifactDrops.length > 0) {
    const listed = opts.artifactDrops
      .map((d) => `\`${d.path || '(missing path)'}\` (${d.reason})`)
      .join(', ');
    await opts.board.comment({
      taskId: opts.taskId,
      by: opts.by,
      text: `Dropped invalid artifact declarations: ${listed}`,
    });
  }
  const links = artifactLinkLines(opts.artifacts, opts.snapshotRef);
  if (links.length > 0) {
    await opts.board.comment({
      taskId: opts.taskId,
      by: opts.by,
      text: `Deliverables:\n${links.join('\n')}`,
    });
  }
}

const ALLOWED_STATUSES: TaskStatus[] = ['backlog', 'triaging', 'working', 'review', 'done', 'failed'];

/**
 * Board status the applier actually writes. Agent-to-agent handoffs that
 * ask for `review` (or omit status) must land in `triaging` so
 * `BoardChannelDriver` will open the next worker session. `review` is the
 * human-waiting column and is not polled. Human targets keep the requested
 * status unchanged.
 */
export function effectiveHandoffStatus(intent: HandoffIntent): TaskStatus | undefined {
  if (intent.targetKind === 'agent') {
    if (!intent.status || intent.status === 'review') return 'triaging';
    return intent.status;
  }
  return intent.status;
}

/** Board principals are `agent-reviewer`; worker sessions use profile id `reviewer`. */
function agentIdentityKey(id: string): string {
  return id.replace(/^agent-/, '');
}

/** True when the target is the same agent that is already running this task. */
export function isSelfHandoff(
  intent: HandoffIntent,
  ...runningAgentIds: Array<string | null | undefined>
): boolean {
  if (intent.targetKind !== 'agent') return false;
  const target = agentIdentityKey(intent.targetId);
  return runningAgentIds.some((id) => !!id && agentIdentityKey(id) === target);
}

/**
 * Self-handoff to the same agent becomes a human assignment so control
 * does not poll a second run. Prefer the user who raised the task;
 * `fallbackHumanId` is the last resort. With no human, keep the agent
 * assignee but park in `review` (not triaging).
 */
export function resolveHandoffIntent(
  intent: HandoffIntent,
  runningAgentIds: readonly (string | null | undefined)[],
  fallbackHumanId?: string,
): HandoffIntent {
  if (!isSelfHandoff(intent, ...runningAgentIds)) return intent;
  const trimmed = fallbackHumanId?.trim();
  if (trimmed) {
    const from = runningAgentIds.find((id) => !!id) ?? 'agent';
    return {
      ...intent,
      targetKind: 'user',
      targetId: trimmed,
      status: intent.status && intent.status !== 'triaging' ? intent.status : 'review',
      message: intent.message
        ? `[self-handoff redirected] ${intent.message}`
        : `[self-handoff redirected] ${from} targeted itself; harness sent this to the operator who raised the task.`,
    };
  }
  return { ...intent, status: 'review' };
}

/**
 * Parse a raw JSON value (typically `JSON.parse('.agent/handoff.json')`)
 * into a `HandoffIntent`. Returns `null` on any validation failure so
 * callers can degrade gracefully without try/catch. Refuses unknown
 * `targetKind` / `status` values rather than coercing them.
 */
export function parseHandoffJson(value: unknown): HandoffIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const kind = obj.targetKind ?? obj.kind;
  const id = obj.targetId ?? obj.id;
  if (kind !== 'agent' && kind !== 'user') return null;
  if (typeof id !== 'string' || id.length === 0) return null;

  const out: HandoffIntent = { targetKind: kind, targetId: id };
  if (typeof obj.status === 'string') {
    if (!ALLOWED_STATUSES.includes(obj.status as TaskStatus)) return null;
    out.status = obj.status as TaskStatus;
  }
  if (typeof obj.message === 'string' && obj.message.length > 0) {
    out.message = obj.message;
  }
  return out;
}

/**
 * Parse from a raw JSON string. Returns `null` on malformed JSON
 * (instead of throwing) so the worker post-run pipeline never gets
 * killed by a typo in agent output.
 */
export function parseHandoffString(raw: string): HandoffIntent | null {
  try {
    return parseHandoffJson(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Build a fallback `HandoffIntent` for a successful worker run that did
 * NOT call the `handoff` tool itself. Without this safety net, tasks
 * silently stall in `review` with the original agent still assigned
 * — the reviewer never picks it up and the operator has no signal that
 * anything went wrong.
 *
 * Returns `null` when:
 *   - the worker did not succeed (failed runs need explicit operator
 *     triage; auto-routing them muddles the audit trail), OR
 *   - no `fallbackHuman` is configured (autobounce disabled).
 *
 * Common reasons an agent ends without a handoff:
 *   1. it hit `policies.maxTurns` mid-exploration,
 *   2. a tool call errored and the model silently gave up,
 *   3. the brief turned out to be a no-op and the model just exited,
 *   4. small / capability-limited model didn't follow the final-action
 *      instruction reliably.
 *
 * The message is intentionally verbose because it's the only signal the
 * operator gets that the agent fell short — keep it actionable.
 */
export function synthesizeFallbackHandoff(opts: {
  workerStatus: 'succeeded' | 'failed';
  workerSummary?: string;
  fromAgentId: string;
  fallbackHuman?: string;
}): HandoffIntent | null {
  if (opts.workerStatus !== 'succeeded') return null;
  if (!opts.fallbackHuman || opts.fallbackHuman.length === 0) return null;
  const trimmed = (opts.workerSummary ?? '').trim();
  const summarySnippet = trimmed.length > 0 ? ` Worker summary: "${trimmed.slice(0, 240)}".` : '';
  return {
    targetKind: 'user',
    targetId: opts.fallbackHuman,
    status: 'review',
    message:
      `[autobounce] ${opts.fromAgentId} ended its turn without calling the \`handoff\` tool, ` +
      `so the harness rerouted this task to you for triage. Likely causes: hit maxTurns mid-task, ` +
      `got stuck on a tool error, brief was effectively a no-op, or the model skipped the final action.` +
      summarySnippet +
      ' Inspect the session events to decide whether to retry, refine the brief, or close.',
  };
}

/** Default agent↔agent bounce limit (coder→reviewer→coder counts as two). */
export const DEFAULT_HANDOFF_CYCLE_CAP = 6;

export function envHandoffCycleCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REMOTE_AGENT_HANDOFF_CYCLE_CAP?.trim();
  if (!raw) return DEFAULT_HANDOFF_CYCLE_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_HANDOFF_CYCLE_CAP;
  return Math.floor(n);
}

export function readHandoffBounceCount(metadata: Record<string, unknown> | undefined): number {
  const n = metadata?.handoffBounceCount;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Reviewer "NEEDS FIXES" used to land on a human. Once a cycle cap exists,
 * bounce those verdicts back to the coder so the loop can close without an
 * operator in the middle (product spec P1.9).
 */
export function resolveHumanHandoffTarget(intent: HandoffIntent, createdBy: string): HandoffIntent {
  if (intent.targetKind !== 'user') return intent;
  const id = intent.targetId.trim().toLowerCase();
  if (id === 'user' || id === 'human' || id === 'operator' || id === 'creator' || id === 'task-creator') {
    return { ...intent, targetId: createdBy };
  }
  return intent;
}

export function rewriteReviewerNeedsFixes(intent: HandoffIntent, fromAgentId: string): HandoffIntent {
  if (agentIdentityKey(fromAgentId) !== 'reviewer') return intent;
  if (intent.targetKind !== 'user') return intent;
  const msg = intent.message ?? '';
  if (!/NEEDS FIXES/i.test(msg)) return intent;
  return {
    ...intent,
    targetKind: 'agent',
    targetId: 'agent-coder',
    status: 'triaging',
  };
}

export interface ApplyHandoffOptions {
  taskId: string;
  intent: HandoffIntent;
  /**
   * Principal id used as `assignedBy` / `by` on the resulting
   * task_events. Typically the source agent (so the audit log says
   * "agent-coder reassigned to agent-reviewer").
   */
  by: string;
  board: Pick<
    BoardStore,
    'getTask' | 'getUser' | 'getAgent' | 'assignTask' | 'updateStatus' | 'comment' | 'mergeTaskMetadata'
  >;
  logger?: { log(message: string): void; warn(message: string): void };
  /**
   * Optional snapshot ref from the source agent's run. Stamped on the
   * board task as `metadata.handoffContext.snapshotRef` so the assignment
   * router can hydrate the next agent's sandbox from this exact workspace
   * (reuses the existing `resumeSnapshotRef` path).
   */
  snapshotRef?: unknown;
  /**
   * Optional `worker_summary` text from the source agent. Stamped on the
   * task so the next agent's seeded prompt can include it as a preamble.
   */
  summary?: string;
  clock?: () => string;
  /**
   * Last-resort human when a self-handoff cannot use `task.createdBy`
   * (unknown/missing user). Typical: `REMOTE_AGENT_AUTOBOUNCE_HUMAN`.
   */
  fallbackHumanId?: string;
  /**
   * Max agent→agent handoffs on one task. Further agent targets bounce to
   * the raiser / autobounce human. Default `REMOTE_AGENT_HANDOFF_CYCLE_CAP` or 6.
   */
  cycleCap?: number;
  artifacts?: CapturedArtifact[];
  artifactDrops?: ArtifactDrop[];
}

export interface ApplyHandoffResult {
  applied: boolean;
  /** Filled when applied=false; the operator-visible reason. */
  reason?: 'task-missing' | 'principal-unknown' | 'principal-kind-mismatch' | 'no-op';
  /** Assignee kind after rewrite / cycle-cap (use this to decide whether to route). */
  resolvedTargetKind?: AssigneeKind;
  resolvedTargetId?: string;
}

/**
 * Apply a parsed handoff intent against the board. Idempotent: if the
 * task is already assigned to `intent.targetId` with the requested
 * status, this is a no-op (still logs).
 *
 * The applier is intentionally permissive on edge cases:
 *  - Unknown principal id ⇒ skip the reassignment, log a warning, but
 *    do NOT fail the run. The operator can fix the assignment via the
 *    UI.
 *  - `targetKind` doesn't match the principal's actual kind (e.g. an
 *    agent id passed with kind='user') ⇒ same — log and skip.
 *  - `intent.status` provided but already that status ⇒ skip the
 *    status update, still apply the reassignment.
 */
export async function applyHandoff(opts: ApplyHandoffOptions): Promise<ApplyHandoffResult> {
  const logger = opts.logger ?? {
    log: (m) => process.stdout.write(`${m}\n`),
    warn: (m) => process.stderr.write(`${m}\n`),
  };
  const taskId = opts.taskId;
  const rawIntent = opts.intent;
  const task = await opts.board.getTask(taskId);
  if (!task) {
    logger.warn(`handoff.task_missing taskId=${taskId} target=${rawIntent.targetKind}:${rawIntent.targetId}`);
    return { applied: false, reason: 'task-missing' };
  }

  const raiser = await opts.board.getUser(task.createdBy);
  const fallbackHumanId = raiser ? task.createdBy : opts.fallbackHumanId;
  // Identity of the agent that just finished — not the current assignee.
  // Matching on assignee would treat a coder→reviewer replay as self-handoff
  // after the board is already on agent-reviewer.
  const runningAgentIds = [opts.by];
  let intent = rewriteReviewerNeedsFixes(rawIntent, opts.by);
  intent = resolveHumanHandoffTarget(intent, task.createdBy);
  intent = resolveHandoffIntent(intent, runningAgentIds, fallbackHumanId);

  const cycleCap = opts.cycleCap ?? envHandoffCycleCap();
  const priorBounces = readHandoffBounceCount(task.metadata as Record<string, unknown> | undefined);
  let bounceCount = priorBounces;
  if (intent.targetKind === 'agent') {
    bounceCount = priorBounces + 1;
    if (bounceCount > cycleCap) {
      const human = fallbackHumanId?.trim();
      if (human) {
        logger.log(
          `handoff.cycle_cap taskId=${taskId} bounces=${bounceCount} cap=${cycleCap} from=${opts.by}`,
        );
        intent = {
          ...intent,
          targetKind: 'user',
          targetId: human,
          status: 'review',
          message: intent.message
            ? `[cycle-cap ${cycleCap}] ${intent.message}`
            : `[cycle-cap] ${opts.by} hit the agent↔agent bounce limit (${cycleCap}); harness sent this to a human.`,
        };
      }
    }
  }
  if (isSelfHandoff(rawIntent, ...runningAgentIds)) {
    logger.log(
      `handoff.self_redirect taskId=${taskId} from=${opts.by} assignee=${task.assigneeId ?? ''} to=${intent.targetKind}:${intent.targetId}`,
    );
  }

  // Validate the target principal exists. We accept any id whose kind
  // matches; if not found we degrade gracefully (so a stale agent id
  // in a prompt doesn't break the loop).
  const principalExists = await (async () => {
    if (intent.targetKind === 'agent') {
      const agent = await opts.board.getAgent(intent.targetId);
      return agent != null;
    }
    const user = await opts.board.getUser(intent.targetId);
    return user != null;
  })();
  if (!principalExists) {
    logger.warn(`handoff.principal_unknown taskId=${taskId} target=${intent.targetKind}:${intent.targetId}`);
    return { applied: false, reason: 'principal-unknown', resolvedTargetKind: intent.targetKind, resolvedTargetId: intent.targetId };
  }

  const appliedStatus =
    isSelfHandoff(rawIntent, ...runningAgentIds) && intent.targetKind === 'agent'
      ? 'review'
      : effectiveHandoffStatus(intent);
  const sameAssignee = task.assigneeId === intent.targetId;
  const sameStatus = appliedStatus ? task.status === appliedStatus : true;
  if (sameAssignee && sameStatus) {
    logger.log(`handoff.noop taskId=${taskId} target=${intent.targetKind}:${intent.targetId}`);
    await commentArtifactsAndDrops({
      board: opts.board,
      taskId,
      by: opts.by,
      artifacts: opts.artifacts,
      artifactDrops: opts.artifactDrops,
      snapshotRef: opts.snapshotRef,
    }).catch(() => {});
    return { applied: false, reason: 'no-op', resolvedTargetKind: intent.targetKind, resolvedTargetId: intent.targetId };
  }

  if (!sameAssignee) {
    await opts.board.assignTask({
      taskId,
      assigneeKind: intent.targetKind,
      assigneeId: intent.targetId,
      assignedBy: opts.by,
    });
  }
  if (appliedStatus && task.status !== appliedStatus) {
    await opts.board.updateStatus({ taskId, status: appliedStatus, by: opts.by });
  }
  if (intent.message) {
    await opts.board.comment({
      taskId,
      by: opts.by,
      text: `Handoff: ${intent.message}`,
    });
  }
  await commentArtifactsAndDrops({
    board: opts.board,
    taskId,
    by: opts.by,
    artifacts: opts.artifacts,
    artifactDrops: opts.artifactDrops,
    snapshotRef: opts.snapshotRef,
  }).catch(() => {});

  // Stamp the cross-session bridge: the next route() that opens a
  // session for `intent.targetId` reads this to hydrate the sandbox from
  // the source agent's snapshot and to enrich the seeded channel.input
  // with the source agent's summary. Without this, the reviewer would
  // see only the original brief and a fresh workspace.
  const handoffContext: HandoffContext = {
    fromAgentId: opts.by,
    toAgentId: intent.targetId,
    snapshotRef: opts.snapshotRef ?? null,
    restoreWorkspaceUri: restoreUriFromSnapshotRef(opts.snapshotRef),
    summary: opts.summary ?? null,
    appliedAt: (opts.clock ?? (() => new Date().toISOString()))(),
    ...(intent.message ? { message: intent.message } : {}),
    ...(opts.artifacts && opts.artifacts.length > 0 ? { artifacts: opts.artifacts } : {}),
  };
  await opts.board.mergeTaskMetadata({
    taskId,
    patch: {
      handoffContext: handoffContext as unknown as Record<string, unknown>,
      handoffBounceCount: bounceCount,
    },
  });

  logger.log(
    `handoff.applied taskId=${taskId} target=${intent.targetKind}:${intent.targetId}` +
    `${appliedStatus ? ` status=${appliedStatus}` : ''}` +
    `${opts.snapshotRef ? ' snapshot=present' : ''}`,
  );
  return {
    applied: true,
    resolvedTargetKind: intent.targetKind,
    resolvedTargetId: intent.targetId,
  };
}
