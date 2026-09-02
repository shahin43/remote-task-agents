/**
 * Frontend view-model types. These mirror exactly what the scheduler `/api/*`
 * board API returns (camelCase). The backend mapper in
 * `packages/scheduler/src/api/board-api.ts` is the source of truth — keep the
 * two in sync.
 */

export type TaskStatus =
  | "backlog"
  | "triaging"
  | "working"
  | "review"
  | "done"
  | "failed";

export type PrincipalKind = "human" | "agent";

export interface Principal {
  id: string;
  displayName: string;
  kind: PrincipalKind;
  title: string | null;
  avatarInitials: string;
  /** Agent capabilities/profile hints; empty for humans. Extendable. */
  capabilities: string[];
}

/** Placeholder domain (no backing table yet) — always empty in v1. */
export interface Tag {
  id: string;
  name: string;
  color: string;
}

/** Placeholder domain (no backing table yet) — always empty in v1. */
export interface Attachment {
  id: string;
  kind: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  author: Principal | null;
  bodyMarkdown: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  actor: Principal | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * One row per worker attempt, joined from agent_runs + session_events.
 * Mirrors TaskAttemptView in board-api.ts. The structured shape replaces the
 * previous flat sandbox keys: all per-attempt info reads from this object.
 */
export interface TaskAttempt {
  /** agent_runs.id (stable per attempt). */
  id: string;
  attemptNumber: number;
  /** starting | sandbox_ready | running | snapshotting | succeeded | failed */
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;

  // Where it ran
  backend: string | null;
  sandboxSessionId: string | null;
  containerId: string | null;
  guestImage: {
    name: string;
    digest: string | null;
    engine: string | null;
    kind: string | null;
    bundleSha256: string | null;
    gitSha: string | null;
    contract: string | null;
  } | null;
  skillsUsed: Array<{ id: string; version: string; contentHash: string; source: string }> | null;

  // What it produced
  snapshotRef: { type: string; id: string; location: string } | null;
  snapshotRefEncoded: string | null;
  agentSummary: string | null;
  error: string | null;
  finishReason: string | null;

  // Conversational
  channelInputs: string[];
  priorSummary: string | null;
  tokenUsage: Record<string, unknown> | null;
}

export interface AgentRun {
  id: string;
  /** The agent spec/profile that ran (e.g. `coder` or `reviewer`). */
  provider: string;
  /** Session status: routing | running | succeeded | failed | cancelled | open | closed. */
  status: string;
  workspaceBackend: string;
  summary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attemptNumber: number | null;
  lastSnapshotRefEncoded: string | null;
  /** Ordered attempts (most recent last). */
  attempts: TaskAttempt[];
  /** Currently-in-flight attempt (status not in succeeded|failed), if any. */
  currentAttempt: TaskAttempt | null;
}

export interface ProjectRepoCatalogEntry {
  slug: string;
  provider: string;
  baseBranch: string;
  dest: string;
  readOnly?: boolean;
  isDefault?: boolean;
}

export interface MrRequestView {
  status: 'pending_approval' | 'blocked' | 'opened' | 'failed' | 'rejected';
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

export interface Task {
  id: string;
  projectId: string;
  issueKey: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  assignee: Principal | null;
  createdBy: string;
  sessionName: string | null;
  workspaceKey: string;
  tags: Tag[];
  attachments: Attachment[];
  comments: Comment[];
  activity: Activity[];
  runs: AgentRun[];
  /** Git repo slugs selected for this task (project catalog subset). */
  repos: string[];
  primaryRepo: string | null;
  mrRequest: MrRequestView | null;
  createdAt: string;
  updatedAt: string;
}

/** One session event mapped for display in the drawer Output feed / runs view. */
export interface ProgressEvent {
  id: string;
  /** The session event `kind` (e.g. assistant_message, tool_call.dispatch_job). */
  eventType: string;
  /** The session event `eventType` bucket: input | action | turn | system. */
  category: string;
  body: string;
  createdAt: string;
}

export interface TaskProgress {
  run: AgentRun | null;
  events: ProgressEvent[];
}

export interface SessionSummary {
  id: string;
  actor: "orchestrator" | "worker";
  agentSpecId: string;
  status: string;
  channelOrigin: string | null;
  /** Parsed board task id when the session originates from the board channel. */
  taskId: string | null;
  openedAt: string;
  closedAt: string | null;
  lastActivityAt: string;
}

export interface SessionDetail extends SessionSummary {
  parentSessionId: string | null;
  metadata: Record<string, unknown>;
  events: ProgressEvent[];
}

export interface AgentProfile {
  id: string;
  displayName: string;
  profileId: string;
  description: string | null;
  engine: string;
  runtime: string;
  model: string | null;
  sandbox: string | null;
  approvalPolicy: string | null;
  limits: {
    maxRuntimeMinutes: number | null;
    maxToolCalls: number | null;
  };
  workspaceRetention: string | null;
  scope: {
    allowedRepos: string[];
    allowedMountTypes: string[];
    maxMountedPaths: number | null;
    pathDenylist: string[];
    egressAllowlist: string[];
  };
  configPath: string;
  source: "service-default" | "repo-per-profile" | "repo-legacy";
}

export interface AgentProfileTemplate {
  id: string;
  actor: string;
  engine: string;
  runtime: string;
  model: string | null;
  description: string | null;
}

export interface TaskRuns {
  sessionId: string;
  attempts: TaskAttempt[];
}

export interface TaskUsageAttempt {
  runId: string;
  attemptNumber: number;
  agentSpecId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface TaskUsage {
  taskId: string;
  attemptCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  attempts: TaskUsageAttempt[];
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

export interface AttemptSnapshot {
  attemptNumber: number;
  status: string;
  summary: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  snapshotRef: { type: string; id: string; location: string } | null;
  snapshotRefEncoded: string | null;
}

export interface SessionSnapshots {
  sessionId: string;
  snapshots: AttemptSnapshot[];
}

export interface SnapshotFileEntry {
  path: string;
  bytes?: number;
  source: "workspace" | "sidecar";
  group?: "key" | "artifacts" | "git" | "repo";
}

export interface SnapshotFiles {
  ref: string;
  index: {
    schemaVersion: 1;
    id: string;
    createdAt: string;
    providerType: string;
    artifacts: Record<string, { checksum: string; bytes: number }>;
    restorable: boolean;
  };
  files: SnapshotFileEntry[];
}
