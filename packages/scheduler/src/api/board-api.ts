import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import {
  boardConversationKey,
  parseBoardConversationKey,
  type Agent,
  type AssigneeKind,
  type BoardTask,
  type SessionEventRecord,
  type SessionRecord,
  type TaskEvent,
  type TaskStatus,
  type User,
} from '@remote-sandbox-agents/contracts';
import type {
  AgentRunGuestImage,
  AgentRunRecord,
  AgentRunsRepo,
  AgentProfilesRepo,
  BoardStore,
  SessionEventsRepo,
  SessionsRepo,
} from '@remote-sandbox-agents/persistence';
import {
  SnapshotError,
  encodeSnapshotRef,
  type SnapshotIndex,
  type SnapshotRef,
  type SnapshotStore,
} from '@remote-sandbox-agents/sandbox';
import { BoardSnapshotService, type BoardSnapshotFile } from '../control/board-snapshots/service.js';
import type { SnapshotStoreRouter } from '../control/board-snapshots/store-router.js';
import type { AgentProfileView } from '../wiring/agent-profile-view.js';
import type { ProjectConfigRegistry } from '../wiring/project-config.js';
import { formatMrPromotionError, promoteMrRequest, rejectMrRequest } from '../wiring/git-artifact-promotion.js';
import { rollupTaskUsage, type TaskUsageView } from '../wiring/token-usage.js';
import {
  ProfileValidationError,
  validateAndBuildProfileDocument,
  type AgentProfileWriteBody,
} from '../wiring/agent-profile-document.js';
import { SHIPPED_BOARD_AGENT_IDS } from '../wiring/ensure-board-principals.js';
import { readTaskMrRequest, type TaskMrRequestRecord } from '../wiring/mr-request.js';
import {
  buildAttemptViews,
  buildSnapshotViews,
  type AttemptInputView,
  type AttemptSnapshotView,
} from '../wiring/session-attempts.js';
import {
  catalogFromProject,
  defaultRepoSlugsForProject,
  normalizeTaskRepoWrite,
  parseTaskRepoSelection,
  taskRepoMetadataPatch,
  TaskRepoSelectionError,
} from '../wiring/task-repo-selection.js';

// ---------------------------------------------------------------------------
// View-model types (mirror packages/web/src/api/types.ts — keep in sync).
// ---------------------------------------------------------------------------

export type PrincipalKind = 'human' | 'agent';

export interface PrincipalView {
  id: string;
  displayName: string;
  kind: PrincipalKind;
  title: string | null;
  avatarInitials: string;
  capabilities: string[];
}

export interface CommentView {
  id: string;
  author: PrincipalView | null;
  bodyMarkdown: string;
  createdAt: string;
}

export interface ActivityView {
  id: string;
  actor: PrincipalView | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * One row per attempt, joined from agent_runs (operational shell) and
 * session_events (conversational content) for the same attemptNumber.
 */
export interface TaskAttemptView {
  id: string;                         // agent_runs.id (stable per attempt)
  attemptNumber: number;
  status: string;                     // agent_runs.status
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;

  // Where it ran (from agent_runs)
  backend: string | null;
  sandboxSessionId: string | null;
  containerId: string | null;
  guestImage: AgentRunGuestImage | null;
  skillsUsed: Array<{ id: string; version: string; contentHash: string; source: string }> | null;

  // What it produced (from agent_runs)
  snapshotRef: SnapshotRef | null;
  snapshotRefEncoded: string | null;
  agentSummary: string | null;        // worker's final message
  error: string | null;
  finishReason: string | null;

  // Conversational (from session_events for this attempt)
  channelInputs: string[];
  priorSummary: string | null;
  tokenUsage: Record<string, unknown> | null;
}

export interface AgentRunView {
  id: string;                         // Hermes session id
  provider: string;
  status: string;
  workspaceBackend: string;
  summary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Highest attempt number known for this session. */
  attemptNumber: number | null;
  /** Last finalized attempt's snapshot, encoded. */
  lastSnapshotRefEncoded: string | null;
  /** Ordered attempts (most recent last). */
  attempts: TaskAttemptView[];
  /** The currently-in-flight attempt, if any (status NOT IN succeeded|failed). */
  currentAttempt: TaskAttemptView | null;
}

export interface AgentProfileTemplateView {
  id: string;
  actor: string;
  engine: string;
  runtime: string;
  model: string | null;
  description: string | null;
}

export interface TaskRunsView {
  sessionId: string;
  attempts: TaskAttemptView[];
}

export interface TaskArtifactView {
  path: string;
  title: string;
  primary: boolean;
  declared: boolean;
  attemptNumber: number;
  snapshotRefEncoded: string | null;
  previewUrl: string;
  downloadUrl: string;
}

export interface TaskArtifactsView {
  taskId: string;
  artifacts: TaskArtifactView[];
}

export interface SessionSnapshotsView {
  sessionId: string;
  snapshots: AttemptSnapshotView[];
}

export interface SnapshotFilesView {
  ref: string;
  index: SnapshotIndex;
  files: BoardSnapshotFile[];
}

export interface MrRequestView {
  status: TaskMrRequestRecord['status'];
  title: string;
  summary: string;
  targetBranch: string;
  draft: boolean;
  fromAgentId: string;
  sessionId: string;
  agentRunId?: string;
  createdAt: string;
  mrUrl?: string;
  mrIid?: number;
  patchArtifact?: string;
  bundleArtifact?: string;
  sourceBranch?: string;
  pushedCommitSha?: string;
  openedAt?: string;
  error?: string;
  rejectedAt?: string;
}

export interface TaskView {
  id: string;
  projectId: string;
  issueKey: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  assignee: PrincipalView | null;
  createdBy: string;
  sessionName: string | null;
  workspaceKey: string;
  tags: never[];
  attachments: never[];
  comments: CommentView[];
  activity: ActivityView[];
  runs: AgentRunView[];
  /** Selected git repo slugs for this task (project catalog subset). */
  repos: string[];
  primaryRepo: string | null;
  /** Agent-requested MR promotion intent, when present. */
  mrRequest: MrRequestView | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressEventView {
  id: string;
  eventType: string;
  category: string;
  body: string;
  createdAt: string;
}

export interface TaskProgressView {
  run: AgentRunView | null;
  events: ProgressEventView[];
}

export interface SessionSummaryView {
  id: string;
  actor: 'orchestrator' | 'worker';
  agentSpecId: string;
  status: string;
  channelOrigin: string | null;
  taskId: string | null;
  openedAt: string;
  closedAt: string | null;
  lastActivityAt: string;
}

export interface SessionDetailView extends SessionSummaryView {
  parentSessionId: string | null;
  metadata: Record<string, unknown>;
  events: ProgressEventView[];
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  sessionName?: string;
  priority?: string;
  assigneeId?: string | null;
  /** Git repo slugs from the project catalog; defaults to project defaultRepos / full catalog. */
  repos?: string[];
  primaryRepo?: string | null;
}

export interface UpdateTaskBody {
  status?: TaskStatus;
  assigneeId?: string | null;
  repos?: string[];
  primaryRepo?: string | null;
}

export interface ProjectRepoCatalogView {
  slug: string;
  provider: string;
  baseBranch: string;
  dest: string;
  readOnly?: boolean;
  isDefault?: boolean;
}

const VALID_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'backlog', 'triaging', 'working', 'review', 'done', 'failed',
]);

// ---------------------------------------------------------------------------
// Mapping helpers (pure — unit-testable).
// ---------------------------------------------------------------------------

export function avatarInitials(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function principalFromUser(user: User): PrincipalView {
  return {
    id: user.id,
    displayName: user.displayName,
    kind: 'human',
    title: null,
    avatarInitials: avatarInitials(user.displayName),
    capabilities: [],
  };
}

function principalFromAgent(agent: Agent): PrincipalView {
  return {
    id: agent.id,
    displayName: agent.displayName,
    kind: 'agent',
    title: agent.profileId,
    avatarInitials: avatarInitials(agent.displayName),
    capabilities: [agent.profileId],
  };
}

function syntheticPrincipal(id: string): PrincipalView {
  return {
    id,
    displayName: id,
    kind: 'human',
    title: null,
    avatarInitials: avatarInitials(id),
    capabilities: [],
  };
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function deriveIssueKey(task: BoardTask): string {
  const fromMeta = task.metadata?.issueKey;
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;
  const prefix = (task.projectId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3) || 'TSK');
  const short = task.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefix}-${short}`;
}

/** Map a board `task_event` kind to the frontend activity event type. */
function mapActivityEventType(kind: TaskEvent['kind']): string {
  switch (kind) {
    case 'created': return 'task_created';
    case 'status_changed': return 'status_changed';
    case 'assigned':
    case 'reassigned':
    case 'unassigned': return 'assignee_changed';
    case 'commented': return 'comment_added';
    default: return kind;
  }
}

function sessionSummaryText(session: SessionRecord): string | null {
  const summary = session.metadata?.summary;
  return typeof summary === 'string' && summary.length > 0 ? summary : null;
}

function encodeRefFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  const ref = metadata?.lastSnapshotRef;
  if (!ref || typeof ref !== 'object') return null;
  const typed = ref as SnapshotRef;
  if (typeof typed.type !== 'string' || typeof typed.id !== 'string') return null;
  return `${typed.type}:${typed.id}`;
}

function encodeRunSnapshotRef(snapshotRef: Record<string, unknown> | null): string | null {
  if (!snapshotRef) return null;
  if (typeof snapshotRef.type !== 'string' || typeof snapshotRef.id !== 'string') return null;
  if (!snapshotRef.type || !snapshotRef.id) return null;
  const location = typeof snapshotRef.location === 'string' ? snapshotRef.location : '';
  return encodeSnapshotRef({ type: snapshotRef.type, id: snapshotRef.id, location });
}

function artifactFileUrls(
  encoded: string | null,
  filePath: string,
): { previewUrl: string; downloadUrl: string } {
  if (!encoded) return { previewUrl: '', downloadUrl: '' };
  const previewUrl = `/api/snapshots/${encodeURIComponent(encoded)}/file?path=${encodeURIComponent(filePath)}`;
  return { previewUrl, downloadUrl: `${previewUrl}&download=1` };
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed']);

/**
 * Merge per-attempt views from two sources:
 *   - agent_runs rows  : operational shell (status, sandbox ids, snapshot, duration, error)
 *   - session_events   : conversational shell (channel inputs, run.summary injections)
 *
 * Both are keyed by attemptNumber. Either source may be missing during early
 * lifecycle states (no agent_runs row yet for first request after startup
 * across a redeploy boundary, no session_events for a row that never ran).
 */
function mergeAttempts(
  runs: AgentRunRecord[],
  eventViews: AttemptInputView[],
): TaskAttemptView[] {
  const byNumber = new Map<number, TaskAttemptView>();

  for (const run of runs) {
    byNumber.set(run.attemptNumber, attemptFromRun(run));
  }
  for (const view of eventViews) {
    const existing = byNumber.get(view.attemptNumber);
    if (existing) {
      // agent_runs is the operational source of truth; only the
      // conversational fields come from session_events. If the ledger says
      // the run already terminated we trust that over a half-completed
      // event projection (e.g. a worker_start without a paired worker_end).
      existing.channelInputs = view.channelInputs;
      existing.priorSummary = view.priorSummary;
      if (!existing.agentSummary) existing.agentSummary = view.assistantSummary ?? null;
    } else {
      // Pre-ledger session (older row from before the agent_runs migration,
      // or a non-sandbox run where no row was inserted).
      byNumber.set(view.attemptNumber, attemptFromEventView(view));
    }
  }

  return [...byNumber.values()].sort((a, b) => a.attemptNumber - b.attemptNumber);
}

function attemptFromRun(run: AgentRunRecord): TaskAttemptView {
  const snapshotRef = run.snapshotRef
    ? ({
        type: (run.snapshotRef.type as string | undefined) ?? 'local',
        id: String(run.snapshotRef.id ?? ''),
        location: String(run.snapshotRef.location ?? ''),
      } as SnapshotRef)
    : null;
  const snapshotRefEncoded = snapshotRef && snapshotRef.id ? `${snapshotRef.type}:${snapshotRef.id}` : null;
  return {
    id: run.id,
    attemptNumber: run.attemptNumber,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    backend: run.backend,
    sandboxSessionId: run.sandboxSessionId,
    containerId: run.containerId,
    guestImage: run.guestImage,
    skillsUsed: run.skillsUsed,
    snapshotRef,
    snapshotRefEncoded,
    agentSummary: run.summary,
    error: run.error,
    finishReason: run.finishReason,
    channelInputs: [],
    priorSummary: null,
    tokenUsage: run.tokenUsage,
  };
}

function attemptFromEventView(view: AttemptInputView): TaskAttemptView {
  const snapshotRef = view.snapshotRef ?? null;
  return {
    id: `events:${view.attemptNumber}`,
    attemptNumber: view.attemptNumber,
    status: view.status,
    startedAt: view.startedAt ?? new Date(0).toISOString(),
    endedAt: view.completedAt,
    durationMs: view.durationMs,
    backend: null,
    sandboxSessionId: null,
    containerId: null,
    guestImage: null,
    skillsUsed: null,
    snapshotRef,
    snapshotRefEncoded: view.snapshotRefEncoded,
    agentSummary: view.assistantSummary ?? null,
    error: view.error,
    finishReason: null,
    channelInputs: view.channelInputs,
    priorSummary: view.priorSummary,
    tokenUsage: null,
  };
}

function mapRun(
  session: SessionRecord,
  events?: SessionEventRecord[],
  runs?: AgentRunRecord[],
): AgentRunView {
  const active = session.status === 'routing';
  const eventViews = events ? buildAttemptViews(events) : [];
  const attempts = mergeAttempts(runs ?? [], eventViews);
  const lastWithSnapshot = [...attempts].reverse().find((a) => a.snapshotRefEncoded);
  const attemptNumber = attempts.length > 0
    ? attempts[attempts.length - 1]!.attemptNumber
    : (typeof session.metadata?.attemptNumber === 'number' ? session.metadata.attemptNumber : null);
  const last = attempts[attempts.length - 1];
  const currentAttempt = last && !TERMINAL_STATUSES.has(last.status) ? last : null;
  return {
    id: session.id,
    provider: session.agentSpecId,
    status: session.status,
    workspaceBackend: currentAttempt?.backend
      ?? last?.backend
      ?? (typeof session.metadata?.runtime === 'string' ? session.metadata.runtime : ''),
    summary: sessionSummaryText(session),
    createdAt: session.openedAt,
    startedAt: active ? null : session.openedAt,
    completedAt: session.closedAt,
    attemptNumber,
    lastSnapshotRefEncoded: lastWithSnapshot?.snapshotRefEncoded ?? encodeRefFromMetadata(session.metadata),
    attempts,
    currentAttempt,
  };
}

function extractBody(payload: unknown): string {
  const record = asRecord(payload);
  for (const key of ['text', 'message', 'summary', 'body']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  if (Object.keys(record).length === 0) return '';
  try {
    return JSON.stringify(record);
  } catch {
    return String(payload);
  }
}

function mapProgressEvent(event: SessionEventRecord): ProgressEventView {
  return {
    id: `${event.sessionId}:${event.eventIndex}`,
    eventType: event.kind,
    category: event.eventType,
    body: extractBody(event.payload),
    createdAt: event.createdAt,
  };
}

function isBoardSession(session: SessionRecord): boolean {
  if (!session.channelOrigin) return false;
  return parseBoardConversationKey(session.channelOrigin) !== null;
}

function mapSessionSummary(session: SessionRecord): SessionSummaryView {
  const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
  return {
    id: session.id,
    actor: session.actor,
    agentSpecId: session.agentSpecId,
    status: session.status,
    channelOrigin: session.channelOrigin,
    taskId: parsed?.taskId ?? null,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    lastActivityAt: session.lastActivityAt,
  };
}

// ---------------------------------------------------------------------------
// Service — depends only on the ports, never on concrete impls.
// ---------------------------------------------------------------------------

export interface BoardApiDeps {
  board: BoardStore;
  sessions: SessionsRepo;
  sessionEvents: SessionEventsRepo;
  /**
   * Optional. When provided, the API joins agent_runs rows into the per-attempt
   * view returned by /api/tasks/:id/runs and the live banner in the Runs tab.
   * Older deployments without the table fall back to event-derived views.
   */
  agentRuns?: AgentRunsRepo;
  agentProfiles?: AgentProfilesRepo;
  tenantId: string;
  projectId: string;
  /** Project workspace catalog (repos + context). Required for repo selection. */
  projects: ProjectConfigRegistry;
  /** Fallback repo slug when project config is missing an entry. */
  defaultRepoSlug: string;
  /** Snapshot persist store (MR promotion fallback). */
  snapshotStore?: SnapshotStore;
  snapshotStores?: SnapshotStoreRouter;
  snapshotBrowser?: BoardSnapshotService;
  /** Root directory for local snapshots (used to decode ref tokens). */
  snapshotRoot?: string;
  /** When set, agent assignments trigger board session routing (enqueue). */
  routeTask?: (taskId: string) => Promise<{ routed: boolean }>;
  /** Reopen the task's session and append a follow-up input. Channel-agnostic. */
  followUp?: (
    channelOrigin: string,
    text: string,
    opts?: { resumeWorkspace?: boolean; actor?: string },
  ) => Promise<{ sessionId: string; reopened: boolean; appendedEventIndex: number }>;
  /** Resolve a read-only profile view for an agent id (config-driven; display only). */
  resolveAgentProfile?: (agentId: string) => Promise<AgentProfileView | null>;
  /** List file-based profile templates available for agent registration. */
  listProfileTemplates?: () => Promise<AgentProfileTemplateView[]>;
  /** Returns true when the agent has an active (non-terminal) board session. */
  agentHasActiveSessions?: (agentId: string) => Promise<boolean>;
  /** Host directory for ephemeral promotion worktrees. */
  promotionRoot?: string;
}

export class BoardApiService {
  constructor(private readonly deps: BoardApiDeps) {}

  private async loadAgents(): Promise<Agent[]> {
    const forProject = await this.deps.board.listAgents(this.deps.projectId);
    const byId = new Map(forProject.map((agent) => [agent.id, agent]));
    for (const id of SHIPPED_BOARD_AGENT_IDS) {
      if (byId.has(id)) continue;
      const existing = await this.deps.board.getAgent(id);
      if (existing) byId.set(id, existing);
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private async principals(): Promise<{ map: Map<string, PrincipalView>; list: PrincipalView[] }> {
    const [users, agents] = await Promise.all([
      this.deps.board.listUsers(this.deps.projectId),
      this.loadAgents(),
    ]);
    const userViews = users.map(principalFromUser);
    const agentViews = agents.map(principalFromAgent);
    const list = [...userViews, ...agentViews];
    const map = new Map<string, PrincipalView>(list.map((p) => [p.id, p]));
    return { map, list };
  }

  /** All sessions whose channel origin is this project's board, grouped by task id. */
  private async sessionsByTask(): Promise<Map<string, SessionRecord[]>> {
    const [orchestrators, workers] = await Promise.all([
      this.deps.sessions.listByActor('orchestrator'),
      this.deps.sessions.listByActor('worker'),
    ]);
    const grouped = new Map<string, SessionRecord[]>();
    for (const session of [...orchestrators, ...workers]) {
      const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
      if (!parsed || parsed.projectId !== this.deps.projectId) continue;
      const bucket = grouped.get(parsed.taskId) ?? [];
      bucket.push(session);
      grouped.set(parsed.taskId, bucket);
    }
    return grouped;
  }

  private async agentRunsForSession(sessionId: string): Promise<AgentRunRecord[]> {
    if (!this.deps.agentRuns) return [];
    try {
      return await this.deps.agentRuns.listForSession(sessionId);
    } catch {
      return [];
    }
  }

  private async mapTask(
    task: BoardTask,
    events: TaskEvent[],
    sessions: SessionRecord[],
    principals: Map<string, PrincipalView>,
  ): Promise<TaskView> {
    const resolve = (actor: string): PrincipalView =>
      principals.get(actor) ?? syntheticPrincipal(actor);

    const comments: CommentView[] = events
      .filter((e) => e.kind === 'commented')
      .map((e) => ({
        id: e.id,
        author: resolve(e.actor),
        bodyMarkdown: typeof e.payload.text === 'string' ? e.payload.text : '',
        createdAt: e.createdAt,
      }));

    const activity: ActivityView[] = events.map((e) => ({
      id: e.id,
      actor: resolve(e.actor),
      eventType: mapActivityEventType(e.kind),
      payload: e.payload,
      createdAt: e.createdAt,
    }));

    const orderedSessions = sessions.slice().sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const runs = await Promise.all(
      orderedSessions.map(async (session) => {
        const agentRunRows = await this.agentRunsForSession(session.id);
        return mapRun(session, undefined, agentRunRows);
      }),
    );

    let assignee: PrincipalView | null = null;
    if (task.assigneeId) {
      assignee = principals.get(task.assigneeId)
        ?? syntheticPrincipal(task.assigneeId);
    }

    const sessionName = typeof task.metadata?.sessionName === 'string'
      ? task.metadata.sessionName
      : null;

    const repoSelection = parseTaskRepoSelection(task.metadata);
    const project = this.deps.projects.resolve(task.projectId, task.tenantId, this.deps.defaultRepoSlug);
    const repos = repoSelection?.repos ?? defaultRepoSlugsForProject(project);
    const primaryRepo = repoSelection?.primaryRepo ?? repos[0] ?? null;
    const mrRaw = readTaskMrRequest(task.metadata);
    const mrRequest: MrRequestView | null = mrRaw
      ? {
          status: mrRaw.status,
          title: mrRaw.title,
          summary: mrRaw.summary,
          targetBranch: mrRaw.targetBranch,
          draft: mrRaw.draft,
          fromAgentId: mrRaw.fromAgentId,
          sessionId: mrRaw.sessionId,
          ...(mrRaw.agentRunId ? { agentRunId: mrRaw.agentRunId } : {}),
          createdAt: mrRaw.createdAt,
          ...(mrRaw.mrUrl ? { mrUrl: mrRaw.mrUrl } : {}),
          ...(mrRaw.mrIid != null ? { mrIid: mrRaw.mrIid } : {}),
          ...(mrRaw.patchArtifact ? { patchArtifact: mrRaw.patchArtifact } : {}),
          ...(mrRaw.bundleArtifact ? { bundleArtifact: mrRaw.bundleArtifact } : {}),
          ...(mrRaw.sourceBranch ? { sourceBranch: mrRaw.sourceBranch } : {}),
          ...(mrRaw.pushedCommitSha ? { pushedCommitSha: mrRaw.pushedCommitSha } : {}),
          ...(mrRaw.openedAt ? { openedAt: mrRaw.openedAt } : {}),
          ...(mrRaw.error ? { error: mrRaw.error } : {}),
          ...(mrRaw.rejectedAt ? { rejectedAt: mrRaw.rejectedAt } : {}),
        }
      : null;

    return {
      id: task.id,
      projectId: task.projectId,
      issueKey: deriveIssueKey(task),
      title: task.title,
      description: task.body,
      status: task.status,
      priority: task.priority,
      assignee,
      createdBy: task.createdBy,
      sessionName,
      workspaceKey: boardConversationKey(task.projectId, task.id),
      tags: [],
      attachments: [],
      comments,
      activity,
      runs,
      repos,
      primaryRepo,
      mrRequest,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private async hydrate(task: BoardTask): Promise<TaskView> {
    const [events, sessionsByTask, principals] = await Promise.all([
      this.deps.board.taskEvents(task.id),
      this.sessionsByTask(),
      this.principals(),
    ]);
    return this.mapTask(task, events, sessionsByTask.get(task.id) ?? [], principals.map);
  }

  async listTasks(): Promise<TaskView[]> {
    const [tasks, sessionsByTask, principals] = await Promise.all([
      this.deps.board.listTasks({ projectId: this.deps.projectId }),
      this.sessionsByTask(),
      this.principals(),
    ]);
    const views = await Promise.all(
      tasks.map(async (task) => {
        const events = await this.deps.board.taskEvents(task.id);
        return this.mapTask(task, events, sessionsByTask.get(task.id) ?? [], principals.map);
      }),
    );
    return views;
  }

  async getTask(taskId: string): Promise<TaskView | null> {
    const task = await this.deps.board.getTask(taskId);
    return task ? this.hydrate(task) : null;
  }

  async listProjectRepos(): Promise<ProjectRepoCatalogView[]> {
    const project = this.deps.projects.resolve(
      this.deps.projectId,
      this.deps.tenantId,
      this.deps.defaultRepoSlug,
    );
    return catalogFromProject(project);
  }

  async createTask(body: CreateTaskBody, actor: string): Promise<TaskView> {
    const project = this.deps.projects.resolve(
      this.deps.projectId,
      this.deps.tenantId,
      this.deps.defaultRepoSlug,
    );
    const metadata: Record<string, unknown> = {};
    if (body.sessionName) metadata.sessionName = body.sessionName;

    const repoSelection = body.repos?.length
      ? normalizeTaskRepoWrite({ repos: body.repos, primaryRepo: body.primaryRepo ?? undefined }, project)
      : {
          repos: defaultRepoSlugsForProject(project),
          primaryRepo: defaultRepoSlugsForProject(project)[0]!,
        };
    Object.assign(metadata, taskRepoMetadataPatch(repoSelection));

    const task = await this.deps.board.createTask({
      tenantId: this.deps.tenantId,
      projectId: this.deps.projectId,
      title: body.title,
      body: body.description ?? '',
      priority: (body.priority as BoardTask['priority']) ?? undefined,
      createdBy: actor,
      metadata,
    });
    if (body.assigneeId) {
      await this.applyAssignee(task.id, body.assigneeId, actor);
    }
    return this.hydrate((await this.deps.board.getTask(task.id))!);
  }

  async updateTask(taskId: string, body: UpdateTaskBody, actor: string): Promise<TaskView | null> {
    const existing = await this.deps.board.getTask(taskId);
    if (!existing) return null;

    if (body.status !== undefined) {
      if (!VALID_STATUSES.has(body.status)) {
        throw new ApiError(400, `invalid status: ${body.status}`);
      }
      await this.deps.board.updateStatus({ taskId, status: body.status, by: actor });
    }

    if ('assigneeId' in body) {
      if (body.assigneeId == null) {
        await this.deps.board.unassignTask({ taskId, by: actor });
      } else {
        await this.applyAssignee(taskId, body.assigneeId, actor);
      }
    }

    if (body.repos !== undefined) {
      const project = this.deps.projects.resolve(
        existing.projectId,
        existing.tenantId,
        this.deps.defaultRepoSlug,
      );
      const selection = normalizeTaskRepoWrite(
        { repos: body.repos, primaryRepo: body.primaryRepo ?? undefined },
        project,
      );
      await this.deps.board.mergeTaskMetadata({
        taskId,
        patch: taskRepoMetadataPatch(selection),
      });
    }

    return this.hydrate((await this.deps.board.getTask(taskId))!);
  }

  private async applyAssignee(taskId: string, assigneeId: string, actor: string): Promise<void> {
    const { map } = await this.principals();
    const principal = map.get(assigneeId);
    const assigneeKind: AssigneeKind = principal?.kind === 'agent' ? 'agent' : 'user';
    await this.deps.board.assignTask({ taskId, assigneeKind, assigneeId, assignedBy: actor });
    if (assigneeKind === 'agent' && this.deps.routeTask) {
      await this.deps.routeTask(taskId);
    }
  }

  async addComment(taskId: string, text: string, actor: string): Promise<TaskView | null> {
    const existing = await this.deps.board.getTask(taskId);
    if (!existing) return null;
    await this.deps.board.comment({ taskId, by: actor, text });
    return this.hydrate((await this.deps.board.getTask(taskId))!);
  }

  async followUpTask(
    taskId: string,
    body: { bodyMarkdown: string; resumeWorkspace?: boolean },
    actor: string,
  ): Promise<TaskView | null> {
    const task = await this.deps.board.getTask(taskId);
    if (!task) return null;
    if (!this.deps.followUp) {
      throw new ApiError(503, 'Follow-up is not enabled on this server.');
    }
    const channelOrigin = boardConversationKey(task.projectId, task.id);
    const session = await this.deps.sessions.findByChannelOrigin(channelOrigin);
    if (!session) {
      throw new ApiError(
        409,
        'No prior agent run to continue. Assign an agent to this task to start a run first.',
      );
    }
    if (session.status === 'running' || session.status === 'routing') {
      throw new ApiError(
        409,
        `Agent run is still ${session.status}; wait for it to finish before sending a follow-up.`,
      );
    }
    await this.deps.followUp(channelOrigin, body.bodyMarkdown, {
      resumeWorkspace: body.resumeWorkspace,
      actor,
    });
    await this.deps.board.comment({ taskId, by: actor, text: body.bodyMarkdown });
    await this.deps.board.updateStatus({ taskId, status: 'working', by: actor });
    return this.hydrate((await this.deps.board.getTask(taskId))!);
  }

  async approveMrRequest(
    taskId: string,
    body: { draft?: boolean; targetBranch?: string },
    actor: string,
  ): Promise<TaskView | null> {
    if (!this.deps.snapshotStore) {
      throw new ApiError(503, 'Snapshot store is not configured on this server.');
    }
    const result = await promoteMrRequest({
      taskId,
      board: this.deps.board,
      projects: this.deps.projects,
      projectId: this.deps.projectId,
      tenantId: this.deps.tenantId,
      defaultRepoSlug: this.deps.defaultRepoSlug,
      snapshotStore: this.deps.snapshotStore,
      snapshotStores: this.deps.snapshotStores,
      by: actor,
      overrides: {
        draft: body.draft,
        targetBranch: body.targetBranch,
      },
      promotionRoot: this.deps.promotionRoot,
    });
    if (!result.ok && result.reason !== 'already-opened') {
      throw new ApiError(400, formatMrPromotionError(result.reason));
    }
    return this.hydrate((await this.deps.board.getTask(taskId))!);
  }

  async rejectMrRequest(taskId: string, actor: string, reason?: string): Promise<TaskView | null> {
    const ok = await rejectMrRequest({
      taskId,
      board: this.deps.board,
      by: actor,
      reason,
    });
    if (!ok) throw new ApiError(409, 'No rejectable MR request on this task.');
    return this.hydrate((await this.deps.board.getTask(taskId))!);
  }

  async taskProgress(taskId: string): Promise<TaskProgressView | null> {
    const task = await this.deps.board.getTask(taskId);
    if (!task) return null;
    const key = boardConversationKey(task.projectId, task.id);
    const session = await this.deps.sessions.findByChannelOrigin(key);
    if (!session) return { run: null, events: [] };
    const [events, agentRunRows] = await Promise.all([
      this.deps.sessionEvents.list(session.id),
      this.agentRunsForSession(session.id),
    ]);
    return { run: mapRun(session, events, agentRunRows), events: events.map(mapProgressEvent) };
  }

  async listAssignees(): Promise<PrincipalView[]> {
    return (await this.principals()).list;
  }

  async listUsers(): Promise<PrincipalView[]> {
    return (await this.deps.board.listUsers(this.deps.projectId)).map(principalFromUser);
  }

  async listAgents(): Promise<PrincipalView[]> {
    return (await this.loadAgents()).map(principalFromAgent);
  }

  async getAgentProfile(agentId: string): Promise<AgentProfileView | null> {
    if (!this.deps.resolveAgentProfile) return null;
    return this.deps.resolveAgentProfile(agentId);
  }

  async listSessions(): Promise<SessionSummaryView[]> {
    const [orchestrators, workers] = await Promise.all([
      this.deps.sessions.listByActor('orchestrator'),
      this.deps.sessions.listByActor('worker'),
    ]);
    return [...orchestrators, ...workers]
      .filter(isBoardSession)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map(mapSessionSummary);
  }

  async getSession(sessionId: string): Promise<SessionDetailView | null> {
    const session = await this.deps.sessions.findById(sessionId);
    if (!session || !isBoardSession(session)) return null;
    const events = await this.deps.sessionEvents.list(sessionId);
    return {
      ...mapSessionSummary(session),
      parentSessionId: session.parentSessionId,
      metadata: session.metadata,
      events: events.map(mapProgressEvent),
    };
  }

  async listSessionEvents(sessionId: string, after = 0): Promise<ProgressEventView[]> {
    const events = await this.deps.sessionEvents.list(sessionId, after);
    return events.map(mapProgressEvent);
  }

  async listProfileTemplates(): Promise<AgentProfileTemplateView[]> {
    if (!this.deps.listProfileTemplates) return [];
    return this.deps.listProfileTemplates();
  }

  async createAgentProfile(body: AgentProfileWriteBody): Promise<{ id: string; version: number }> {
    if (!this.deps.agentProfiles) throw new ApiError(501, 'agent profile registry is not configured');
    const built = validateAndBuildProfileDocument(body);
    const existing = await this.deps.agentProfiles.getLatest(this.deps.tenantId, built.profileId);
    if (existing) throw new ApiError(409, `Profile already exists: ${built.profileId}`);
    const row = await this.deps.agentProfiles.insertVersion({
      tenantId: this.deps.tenantId,
      profileId: built.profileId,
      document: built.document as unknown as Record<string, unknown>,
      soul: built.soul,
      basePrompt: built.basePrompt,
    });
    return { id: row.profileId, version: row.version };
  }

  async updateAgentProfile(profileId: string, body: Omit<AgentProfileWriteBody, 'id'> & { id?: string }): Promise<{ id: string; version: number }> {
    if (!this.deps.agentProfiles) throw new ApiError(501, 'agent profile registry is not configured');
    const built = validateAndBuildProfileDocument({ ...body, id: profileId });
    const existing = await this.deps.agentProfiles.getLatest(this.deps.tenantId, profileId);
    if (!existing) throw new ApiError(404, `Unknown profile: ${profileId}`);
    const row = await this.deps.agentProfiles.insertVersion({
      tenantId: this.deps.tenantId,
      profileId,
      document: built.document as unknown as Record<string, unknown>,
      soul: built.soul,
      basePrompt: built.basePrompt,
    });
    return { id: row.profileId, version: row.version };
  }

  async createAgent(body: { id?: string; displayName: string; profileId: string }): Promise<PrincipalView> {
    const templates = await this.listProfileTemplates();
    if (!templates.some((t) => t.id === body.profileId)) {
      throw new ApiError(400, `Unknown profile template: ${body.profileId}`);
    }
    const displayName = body.displayName.trim();
    if (!displayName) throw new ApiError(400, 'displayName is required.');
    const id = (body.id?.trim() || `agent-${slugify(displayName)}`).slice(0, 64);
    if (!id) throw new ApiError(400, 'id is required.');
    const existing = await this.deps.board.getAgent(id);
    if (existing) throw new ApiError(409, `Agent already exists: ${id}`);
    const agent = await this.deps.board.upsertAgent({
      id,
      tenantId: this.deps.tenantId,
      projectId: this.deps.projectId,
      profileId: body.profileId,
      displayName,
    });
    return principalFromAgent(agent);
  }

  async updateAgent(
    agentId: string,
    body: { displayName?: string; profileId?: string },
  ): Promise<PrincipalView | null> {
    const existing = await this.deps.board.getAgent(agentId);
    if (!existing || existing.projectId !== this.deps.projectId) return null;
    if (body.profileId) {
      const templates = await this.listProfileTemplates();
      if (!templates.some((t) => t.id === body.profileId)) {
        throw new ApiError(400, `Unknown profile template: ${body.profileId}`);
      }
    }
    const displayName = body.displayName?.trim() || existing.displayName;
    const agent = await this.deps.board.upsertAgent({
      ...existing,
      displayName,
      profileId: body.profileId ?? existing.profileId,
    });
    return principalFromAgent(agent);
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const existing = await this.deps.board.getAgent(agentId);
    if (!existing || existing.projectId !== this.deps.projectId) return false;
    if (this.deps.agentHasActiveSessions) {
      const active = await this.deps.agentHasActiveSessions(agentId);
      if (active) {
        throw new ApiError(409, 'Cannot delete an agent with an active run. Wait for tasks to finish.');
      }
    }
    return this.deps.board.deleteAgent(agentId);
  }

  async taskRuns(taskId: string): Promise<TaskRunsView | null> {
    const task = await this.deps.board.getTask(taskId);
    if (!task) return null;
    const key = boardConversationKey(task.projectId, task.id);
    const session = await this.deps.sessions.findByChannelOrigin(key);
    if (!session) return { sessionId: '', attempts: [] };
    const [events, agentRunRows] = await Promise.all([
      this.deps.sessionEvents.list(session.id),
      this.agentRunsForSession(session.id),
    ]);
    const attempts = mergeAttempts(agentRunRows, buildAttemptViews(events));
    return { sessionId: session.id, attempts };
  }

  async taskUsage(taskId: string): Promise<TaskUsageView | null> {
    const task = await this.deps.board.getTask(taskId);
    if (!task) return null;
    const runs = this.deps.agentRuns ? await this.deps.agentRuns.listForTask(taskId) : [];
    return rollupTaskUsage(taskId, runs);
  }

  async taskArtifacts(taskId: string): Promise<TaskArtifactsView | null> {
    const task = await this.deps.board.getTask(taskId);
    if (!task) return null;
    const runs = this.deps.agentRuns ? await this.deps.agentRuns.listForTask(taskId) : [];
    const ordered = [...runs].sort((a, b) => {
      if (a.attemptNumber !== b.attemptNumber) return a.attemptNumber - b.attemptNumber;
      return a.startedAt.localeCompare(b.startedAt);
    });

    const byPath = new Map<string, TaskArtifactView>();
    for (const run of ordered) {
      if (!run.artifacts) continue;
      const snapshotRefEncoded = encodeRunSnapshotRef(run.snapshotRef);
      for (const item of run.artifacts) {
        const { previewUrl, downloadUrl } = artifactFileUrls(snapshotRefEncoded, item.path);
        byPath.set(item.path, {
          path: item.path,
          title: item.title,
          primary: item.primary,
          declared: item.declared,
          attemptNumber: run.attemptNumber,
          snapshotRefEncoded,
          previewUrl,
          downloadUrl,
        });
      }
    }

    const artifacts = [...byPath.values()];
    const primaries = artifacts.filter((a) => a.primary);
    if (primaries.length > 1) {
      const winner = primaries.reduce((best, a) =>
        a.attemptNumber >= best.attemptNumber ? a : best,
      );
      for (const artifact of artifacts) {
        artifact.primary = artifact.path === winner.path;
      }
    } else if (primaries.length === 0 && artifacts[0]) {
      artifacts[0].primary = true;
    }

    return { taskId, artifacts };
  }

  async listSessionSnapshots(sessionId: string): Promise<SessionSnapshotsView | null> {
    const session = await this.deps.sessions.findById(sessionId);
    if (!session || !isBoardSession(session)) return null;
    const events = await this.deps.sessionEvents.list(sessionId);
    return { sessionId, snapshots: buildSnapshotViews(events) };
  }

  async listSnapshotFiles(encodedRef: string): Promise<SnapshotFilesView> {
    if (!this.deps.snapshotBrowser) {
      throw new ApiError(503, 'Snapshot browsing is not enabled on this server.');
    }
    try {
      return await this.deps.snapshotBrowser.listBoardFiles(encodedRef);
    } catch (err) {
      if (err instanceof SnapshotError) throw new ApiError(404, 'snapshot not found');
      throw err;
    }
  }

  async readSnapshotFile(
    encodedRef: string,
    filePath: string,
    opts?: { download?: boolean },
  ): Promise<{ path: string; body: Buffer; contentType: string; filename: string; truncated: boolean }> {
    if (!this.deps.snapshotBrowser) {
      throw new ApiError(503, 'Snapshot browsing is not enabled on this server.');
    }
    try {
      return await this.deps.snapshotBrowser.readBoardFile(encodedRef, filePath, opts);
    } catch (err) {
      if (err instanceof SnapshotError) throw new ApiError(404, 'snapshot file not found');
      throw err;
    }
  }

  async zipSnapshotArtifacts(encodedRef: string): Promise<{ body: Buffer; filename: string }> {
    if (!this.deps.snapshotBrowser) {
      throw new ApiError(503, 'Snapshot browsing is not enabled on this server.');
    }
    try {
      const zip = await this.deps.snapshotBrowser.zipArtifacts(encodedRef);
      if (!zip) throw new ApiError(404, 'no artifacts in this snapshot');
      return zip;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof SnapshotError) throw new ApiError(404, 'snapshot not found');
      throw err;
    }
  }

  async downloadSnapshotWorkspace(
    encodedRef: string,
  ): Promise<{ body: Buffer; filename: string; contentType: string }> {
    if (!this.deps.snapshotBrowser) {
      throw new ApiError(503, 'Snapshot browsing is not enabled on this server.');
    }
    try {
      const archive = await this.deps.snapshotBrowser.readWorkspaceArchive(encodedRef);
      if (!archive) throw new ApiError(404, 'workspace archive not found');
      return archive;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof SnapshotError) throw new ApiError(404, 'snapshot not found');
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP adapter — routes `/api/*`. Returns true when it handled the request.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface BoardApiHandlerOptions {
  service: BoardApiService;
  /** True when control writes require auth (i.e. REMOTE_AGENT_API_TOKEN is set). */
  controlAuthRequired: boolean;
  /** Returns true when the request is authorized for writes. */
  authorize?: (request: IncomingMessage) => boolean;
  /** Resolve the acting actor for mutations (x-remote-agent-actor). */
  readActor?: (request: IncomingMessage) => string;
  /** Optional dependency health probe (e.g. database ping). */
  healthCheck?: () => Promise<{ database: 'up' | 'down' }>;
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-remote-agent-token, x-remote-agent-actor',
};

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...CORS_HEADERS,
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new ApiError(413, 'Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }
}

function defaultReadActor(request: IncomingMessage): string {
  const header = request.headers['x-remote-agent-actor'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.trim() ? value.trim() : 'operator';
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'agent';
}

function writeBytes(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: Buffer,
  extra: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
    ...CORS_HEADERS,
    ...extra,
  });
  response.end(body);
}

function safeFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, '_');
}

function writeText(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    ...CORS_HEADERS,
  });
  response.end(body);
}

/**
 * Build the `/api/*` request handler for the board UI. Plane-separated and
 * port-based: it only knows the `BoardApiService`, never the orchestrator loop
 * or concrete repos. Mount it ahead of the legacy V0 routes in `--role api`.
 */
export function createBoardApiHandler(options: BoardApiHandlerOptions) {
  const { service, controlAuthRequired } = options;
  const authorize = options.authorize ?? (() => true);
  const readActor = options.readActor ?? defaultReadActor;
  const healthCheck = options.healthCheck ?? (async () => ({ database: 'up' as const }));

  return async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const { pathname } = url;
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return false;

    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return true;
    }

    const method = request.method ?? 'GET';
    const isWrite = method === 'POST' || method === 'PATCH' || method === 'DELETE';

    try {
      if (pathname === '/api/health') {
        const checks = await healthCheck();
        const ok = checks.database === 'up';
        writeJson(response, ok ? 200 : 503, { ok, controlAuthRequired, checks });
        return true;
      }

      if (isWrite && !authorize(request)) {
        writeJson(response, 401, { error: 'unauthorized', message: 'Control auth required.' });
        return true;
      }

      // --- Project catalog ---
      if (pathname === '/api/projects/repos' && method === 'GET') {
        writeJson(response, 200, await service.listProjectRepos());
        return true;
      }

      // --- Tasks ---
      if (pathname === '/api/tasks' && method === 'GET') {
        writeJson(response, 200, await service.listTasks());
        return true;
      }
      if (pathname === '/api/tasks' && method === 'POST') {
        const body = await readJsonBody(request);
        if (typeof body.title !== 'string' || !body.title.trim()) {
          throw new ApiError(400, 'title is required.');
        }
        const created = await service.createTask(
          {
            title: body.title,
            description: typeof body.description === 'string' ? body.description : '',
            sessionName: typeof body.sessionName === 'string' ? body.sessionName : undefined,
            priority: typeof body.priority === 'string' ? body.priority : undefined,
            assigneeId: typeof body.assigneeId === 'string' ? body.assigneeId : null,
            repos: Array.isArray(body.repos)
              ? body.repos.filter((v): v is string => typeof v === 'string')
              : undefined,
            primaryRepo: typeof body.primaryRepo === 'string' ? body.primaryRepo : undefined,
          },
          readActor(request),
        );
        writeJson(response, 201, created);
        return true;
      }

      const progressMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/progress$/);
      if (progressMatch && method === 'GET') {
        const taskId = decodeURIComponent(progressMatch[1]!);
        const progress = await service.taskProgress(taskId);
        if (!progress) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, progress);
        return true;
      }

      const taskRunsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
      if (taskRunsMatch && method === 'GET') {
        const taskId = decodeURIComponent(taskRunsMatch[1]!);
        const runs = await service.taskRuns(taskId);
        if (!runs) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, runs);
        return true;
      }

      const taskUsageMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/usage$/);
      if (taskUsageMatch && method === 'GET') {
        const taskId = decodeURIComponent(taskUsageMatch[1]!);
        const usage = await service.taskUsage(taskId);
        if (!usage) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, usage);
        return true;
      }

      const taskArtifactsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts$/);
      if (taskArtifactsMatch && method === 'GET') {
        const taskId = decodeURIComponent(taskArtifactsMatch[1]!);
        const artifacts = await service.taskArtifacts(taskId);
        if (!artifacts) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, artifacts);
        return true;
      }

      const commentMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments$/);
      if (commentMatch && method === 'POST') {
        const taskId = decodeURIComponent(commentMatch[1]!);
        const body = await readJsonBody(request);
        const text = typeof body.bodyMarkdown === 'string' ? body.bodyMarkdown : '';
        if (!text.trim()) throw new ApiError(400, 'bodyMarkdown is required.');
        const updated = await service.addComment(taskId, text, readActor(request));
        if (!updated) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, updated);
        return true;
      }

      const followUpMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/follow-up$/);
      if (followUpMatch && method === 'POST') {
        const taskId = decodeURIComponent(followUpMatch[1]!);
        const body = await readJsonBody(request);
        const text = typeof body.bodyMarkdown === 'string' ? body.bodyMarkdown : '';
        if (!text.trim()) throw new ApiError(400, 'bodyMarkdown is required.');
        const resumeWorkspace = body.resumeWorkspace === true;
        const updated = await service.followUpTask(taskId, { bodyMarkdown: text, resumeWorkspace }, readActor(request));
        if (!updated) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, updated);
        return true;
      }

      const mrApproveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/mr-request\/approve$/);
      if (mrApproveMatch && method === 'POST') {
        const taskId = decodeURIComponent(mrApproveMatch[1]!);
        const body = (await readJsonBody(request).catch(() => ({}))) as Record<string, unknown>;
        const updated = await service.approveMrRequest(
          taskId,
          {
            draft: body.draft === undefined ? undefined : Boolean(body.draft),
            targetBranch: typeof body.targetBranch === 'string' ? body.targetBranch : undefined,
          },
          readActor(request),
        );
        if (!updated) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, updated);
        return true;
      }

      const mrRejectMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/mr-request\/reject$/);
      if (mrRejectMatch && method === 'POST') {
        const taskId = decodeURIComponent(mrRejectMatch[1]!);
        const body = (await readJsonBody(request).catch(() => ({}))) as Record<string, unknown>;
        const reason = typeof body.reason === 'string' ? body.reason : undefined;
        const updated = await service.rejectMrRequest(taskId, readActor(request), reason);
        if (!updated) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, updated);
        return true;
      }

      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && method === 'GET') {
        const taskId = decodeURIComponent(taskMatch[1]!);
        const task = await service.getTask(taskId);
        if (!task) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, task);
        return true;
      }
      if (taskMatch && method === 'PATCH') {
        const taskId = decodeURIComponent(taskMatch[1]!);
        const body = await readJsonBody(request);
        const patch: UpdateTaskBody = {};
        if (typeof body.status === 'string') patch.status = body.status as TaskStatus;
        if ('assigneeId' in body) {
          patch.assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId : null;
        }
        if (Array.isArray(body.repos)) {
          patch.repos = body.repos.filter((v): v is string => typeof v === 'string');
        }
        if (typeof body.primaryRepo === 'string') {
          patch.primaryRepo = body.primaryRepo;
        }
        const updated = await service.updateTask(taskId, patch, readActor(request));
        if (!updated) { writeJson(response, 404, { error: 'task_not_found' }); return true; }
        writeJson(response, 200, updated);
        return true;
      }

      // --- Principals ---
      if (pathname === '/api/assignees' && method === 'GET') {
        writeJson(response, 200, await service.listAssignees());
        return true;
      }
      if (pathname === '/api/users' && method === 'GET') {
        writeJson(response, 200, await service.listUsers());
        return true;
      }
      if (pathname === '/api/agents' && method === 'GET') {
        writeJson(response, 200, await service.listAgents());
        return true;
      }
      if (pathname === '/api/agents' && method === 'POST') {
        const body = await readJsonBody(request);
        const displayName = typeof body.displayName === 'string' ? body.displayName : '';
        const profileId = typeof body.profileId === 'string' ? body.profileId : '';
        if (!profileId.trim()) throw new ApiError(400, 'profileId is required.');
        const created = await service.createAgent({
          id: typeof body.id === 'string' ? body.id : undefined,
          displayName,
          profileId,
        });
        writeJson(response, 201, created);
        return true;
      }
      if (pathname === '/api/agent-profiles' && method === 'GET') {
        writeJson(response, 200, await service.listProfileTemplates());
        return true;
      }
      if (pathname === '/api/agent-profiles' && method === 'POST') {
        const body = await readJsonBody(request) as unknown as AgentProfileWriteBody;
        const created = await service.createAgentProfile(body);
        writeJson(response, 201, created);
        return true;
      }
      const profilePut = pathname.match(/^\/api\/agent-profiles\/([^/]+)$/);
      if (profilePut && method === 'PUT') {
        const profileId = decodeURIComponent(profilePut[1]!);
        const body = await readJsonBody(request) as unknown as Omit<AgentProfileWriteBody, 'id'>;
        const updated = await service.updateAgentProfile(profileId, body);
        writeJson(response, 200, updated);
        return true;
      }
      const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch && method === 'GET') {
        const agentId = decodeURIComponent(agentMatch[1]!);
        const view = await service.getAgentProfile(agentId);
        if (!view) { writeJson(response, 404, { error: 'agent_not_found' }); return true; }
        writeJson(response, 200, view);
        return true;
      }
      if (agentMatch && method === 'PATCH') {
        const agentId = decodeURIComponent(agentMatch[1]!);
        const body = await readJsonBody(request);
        const updated = await service.updateAgent(agentId, {
          displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
          profileId: typeof body.profileId === 'string' ? body.profileId : undefined,
        });
        if (!updated) { writeJson(response, 404, { error: 'agent_not_found' }); return true; }
        writeJson(response, 200, updated);
        return true;
      }
      if (agentMatch && method === 'DELETE') {
        const agentId = decodeURIComponent(agentMatch[1]!);
        const deleted = await service.deleteAgent(agentId);
        if (!deleted) { writeJson(response, 404, { error: 'agent_not_found' }); return true; }
        response.writeHead(204, CORS_HEADERS);
        response.end();
        return true;
      }

      // --- Sessions / runs ---
      if (pathname === '/api/sessions' && method === 'GET') {
        writeJson(response, 200, await service.listSessions());
        return true;
      }
      const sessionEventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
      if (sessionEventsMatch && method === 'GET') {
        const sessionId = decodeURIComponent(sessionEventsMatch[1]!);
        const after = Number(url.searchParams.get('after') ?? '0');
        writeJson(response, 200, await service.listSessionEvents(sessionId, Number.isFinite(after) ? after : 0));
        return true;
      }
      const sessionSnapshotsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/snapshots$/);
      if (sessionSnapshotsMatch && method === 'GET') {
        const sessionId = decodeURIComponent(sessionSnapshotsMatch[1]!);
        const snapshots = await service.listSessionSnapshots(sessionId);
        if (!snapshots) { writeJson(response, 404, { error: 'session_not_found' }); return true; }
        writeJson(response, 200, snapshots);
        return true;
      }
      const snapshotFilesMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/files$/);
      if (snapshotFilesMatch && method === 'GET') {
        const encodedRef = decodeURIComponent(snapshotFilesMatch[1]!);
        writeJson(response, 200, await service.listSnapshotFiles(encodedRef));
        return true;
      }
      const snapshotZipMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/artifacts\.zip$/);
      if (snapshotZipMatch && method === 'GET') {
        const encodedRef = decodeURIComponent(snapshotZipMatch[1]!);
        const zip = await service.zipSnapshotArtifacts(encodedRef);
        writeBytes(response, 200, 'application/zip', zip.body, {
          'content-disposition': `attachment; filename="${safeFilename(zip.filename)}"`,
        });
        return true;
      }
      const snapshotWorkspaceMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/workspace\.tar$/);
      if (snapshotWorkspaceMatch && method === 'GET') {
        const encodedRef = decodeURIComponent(snapshotWorkspaceMatch[1]!);
        const archive = await service.downloadSnapshotWorkspace(encodedRef);
        writeBytes(response, 200, archive.contentType, archive.body, {
          'content-disposition': `attachment; filename="${safeFilename(archive.filename)}"`,
        });
        return true;
      }
      const snapshotFileMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/file$/);
      if (snapshotFileMatch && method === 'GET') {
        const encodedRef = decodeURIComponent(snapshotFileMatch[1]!);
        const filePath = url.searchParams.get('path') ?? '';
        if (!filePath.trim()) throw new ApiError(400, 'path query parameter is required.');
        const download = url.searchParams.get('download') === '1';
        const file = await service.readSnapshotFile(encodedRef, filePath, { download });
        writeBytes(response, 200, file.contentType, file.body, download
          ? { 'content-disposition': `attachment; filename="${safeFilename(file.filename)}"` }
          : {});
        return true;
      }
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && method === 'GET') {
        const sessionId = decodeURIComponent(sessionMatch[1]!);
        const detail = await service.getSession(sessionId);
        if (!detail) { writeJson(response, 404, { error: 'session_not_found' }); return true; }
        writeJson(response, 200, detail);
        return true;
      }

      writeJson(response, 404, { error: 'not_found' });
      return true;
    } catch (error) {
      if (error instanceof TaskRepoSelectionError) {
        writeJson(response, 400, { error: 'invalid_repo_selection', message: error.message });
        return true;
      }
      if (error instanceof ProfileValidationError) {
        writeJson(response, error.status, { error: 'request_error', message: error.message });
        return true;
      }
      if (error instanceof ApiError) {
        writeJson(response, error.status, { error: 'request_error', message: error.message });
      } else {
        writeJson(response, 500, {
          error: 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
  };
}
