import type { DatabasePool } from './connection.js';

/**
 * One row per worker attempt (the "runner agent" view). Backed by the
 * `agent_runs` table (migration 0005). See migrations/0005_agent_runs.sql for
 * the rationale and lifecycle.
 *
 * Distinct from:
 *   - `sessions`          : durable Hermes conversation (one row per task).
 *   - `session_events`    : append-only event log (audit + LLM replay source).
 *   - `task_events`       : board activity feed (user-facing).
 *   - V0 `remote_agent_runs` / `RunRepo` : legacy task/run schema — unused by board flow.
 *
 * Lifecycle:
 *   1. start()    — insert (status='starting', started_at=now). Returns the row.
 *   2. markSandboxReady() — patch (status='sandbox_ready', backend, sandbox_session_id,
 *                          container_id, workspace_location, sandbox_ready_at).
 *   3. finalize() — patch (status='succeeded'|'failed', ended_at, duration_ms,
 *                  snapshot_ref, summary, error, finish_reason, token_usage, tools_used).
 *
 * Each write is independently idempotent on the row id. Failures in one step
 * leave the row in an intermediate state (e.g. `starting` with NULL sandbox
 * fields) which is itself informative for operators.
 */
export type AgentRunStatus =
  | 'starting'
  | 'sandbox_ready'
  | 'running'
  | 'snapshotting'
  | 'succeeded'
  | 'failed';

export interface AgentRunGuestImage {
  name: string;
  digest: string | null;
  engine: string | null;
  kind: string | null;
  bundleSha256: string | null;
  gitSha: string | null;
  contract: string | null;
}

export interface AgentRunArtifact {
  path: string;
  title: string;
  primary: boolean;
  declared: boolean;
}

export interface AgentRunRecord {
  id: string;
  sessionId: string;
  taskId: string | null;
  attemptNumber: number;
  status: AgentRunStatus;
  agentSpecId: string;
  backend: string | null;
  sandboxSessionId: string | null;
  containerId: string | null;
  workspaceLocation: string | null;
  startedAt: string;
  sandboxReadyAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  snapshotRef: Record<string, unknown> | null;
  summary: string | null;
  error: string | null;
  finishReason: string | null;
  tokenUsage: Record<string, unknown> | null;
  toolsUsed: string[] | null;
  guestImage: AgentRunGuestImage | null;
  skillsUsed: Array<{ id: string; version: string; contentHash: string; source: string }> | null;
  artifacts: AgentRunArtifact[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface StartAgentRunInput {
  id: string;
  sessionId: string;
  taskId?: string | null;
  attemptNumber: number;
  agentSpecId: string;
}

export interface MarkSandboxReadyInput {
  id: string;
  backend: string;
  sandboxSessionId: string;
  containerId?: string | null;
  workspaceLocation?: string | null;
  guestImage?: AgentRunGuestImage | null;
}

export interface FinalizeAgentRunInput {
  id: string;
  status: 'succeeded' | 'failed';
  endedAt: string;
  durationMs: number;
  snapshotRef?: Record<string, unknown> | null;
  summary?: string | null;
  error?: string | null;
  finishReason?: string | null;
  tokenUsage?: Record<string, unknown> | null;
  toolsUsed?: string[] | null;
  skillsUsed?: Array<{ id: string; version: string; contentHash: string; source: string }> | null;
  artifacts?: AgentRunArtifact[] | null;
}

/**
 * Compact projection used by the snapshot retention sweep
 * (`packages/scheduler/src/wiring/snapshot-retention.ts`). The sweep needs
 * to know, for each persisted snapshot id, whether any `agent_runs` row
 * still references it and whether that run is still in-flight (so the
 * sweep never reclaims a snapshot that a worker is actively writing or a
 * follow-up is about to hydrate from).
 */
export interface AgentRunSnapshotRefRow {
  snapshotId: string;
  taskId: string | null;
  inFlight: boolean;
  startedAt: string;
}

export interface AgentRunsRepo {
  start(input: StartAgentRunInput): Promise<AgentRunRecord>;
  markSandboxReady(input: MarkSandboxReadyInput): Promise<void>;
  setStatus(id: string, status: AgentRunStatus): Promise<void>;
  finalize(input: FinalizeAgentRunInput): Promise<void>;
  findById(id: string): Promise<AgentRunRecord | null>;
  listForSession(sessionId: string): Promise<AgentRunRecord[]>;
  listForTask(taskId: string): Promise<AgentRunRecord[]>;
  listLive(): Promise<AgentRunRecord[]>;
  /**
   * One row per `agent_runs` record that carries a `snapshot_ref->>id`,
   * with the metadata the retention sweep needs.
   */
  listSnapshotRefs(): Promise<AgentRunSnapshotRefRow[]>;
}

interface RawRow {
  id: string;
  session_id: string;
  task_id: string | null;
  attempt_number: number | string;
  status: AgentRunStatus;
  agent_spec_id: string;
  backend: string | null;
  sandbox_session_id: string | null;
  container_id: string | null;
  workspace_location: string | null;
  started_at: unknown;
  sandbox_ready_at: unknown;
  ended_at: unknown;
  duration_ms: number | string | null;
  snapshot_ref: Record<string, unknown> | null;
  summary: string | null;
  error: string | null;
  finish_reason: string | null;
  token_usage: Record<string, unknown> | null;
  tools_used: string[] | null;
  guest_image: AgentRunGuestImage | null;
  skills_used: Array<{ id: string; version: string; contentHash: string; source: string }> | null;
  artifacts: AgentRunArtifact[] | null;
  created_at: unknown;
  updated_at: unknown;
  [key: string]: unknown;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const num = (v: number | string | null): number | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? Number(v) : v;

function rowToRecord(row: RawRow): AgentRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    attemptNumber: typeof row.attempt_number === 'string' ? Number(row.attempt_number) : row.attempt_number,
    status: row.status,
    agentSpecId: row.agent_spec_id,
    backend: row.backend,
    sandboxSessionId: row.sandbox_session_id,
    containerId: row.container_id,
    workspaceLocation: row.workspace_location,
    startedAt: iso(row.started_at),
    sandboxReadyAt: isoOrNull(row.sandbox_ready_at),
    endedAt: isoOrNull(row.ended_at),
    durationMs: num(row.duration_ms),
    snapshotRef: row.snapshot_ref,
    summary: row.summary,
    error: row.error,
    finishReason: row.finish_reason,
    tokenUsage: row.token_usage,
    toolsUsed: row.tools_used,
    guestImage: row.guest_image ?? null,
    skillsUsed: row.skills_used ?? null,
    artifacts: Array.isArray(row.artifacts) ? row.artifacts : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class PgAgentRunsRepo implements AgentRunsRepo {
  constructor(private readonly pool: DatabasePool) {}

  async start(input: StartAgentRunInput): Promise<AgentRunRecord> {
    const { rows } = await this.pool.query<RawRow>(
      `INSERT INTO agent_runs(id, session_id, task_id, attempt_number, status, agent_spec_id)
       VALUES ($1, $2, $3, $4, 'starting', $5)
       RETURNING *`,
      [input.id, input.sessionId, input.taskId ?? null, input.attemptNumber, input.agentSpecId],
    );
    return rowToRecord(rows[0]!);
  }

  async markSandboxReady(input: MarkSandboxReadyInput): Promise<void> {
    await this.pool.query(
      `UPDATE agent_runs SET
         status='sandbox_ready',
         backend=$2,
         sandbox_session_id=$3,
         container_id=$4,
         workspace_location=$5,
         guest_image=$6::jsonb,
         sandbox_ready_at=now(),
         updated_at=now()
       WHERE id=$1`,
      [
        input.id,
        input.backend,
        input.sandboxSessionId,
        input.containerId ?? null,
        input.workspaceLocation ?? null,
        input.guestImage ? JSON.stringify(input.guestImage) : null,
      ],
    );
  }

  async setStatus(id: string, status: AgentRunStatus): Promise<void> {
    await this.pool.query(`UPDATE agent_runs SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);
  }

  async finalize(input: FinalizeAgentRunInput): Promise<void> {
    await this.pool.query(
      `UPDATE agent_runs SET
         status=$2,
         ended_at=$3,
         duration_ms=$4,
         snapshot_ref=$5::jsonb,
         summary=$6,
         error=$7,
         finish_reason=$8,
         token_usage=$9::jsonb,
         tools_used=$10::jsonb,
         skills_used=$11::jsonb,
         artifacts=$12::jsonb,
         updated_at=now()
       WHERE id=$1`,
      [
        input.id,
        input.status,
        input.endedAt,
        input.durationMs,
        input.snapshotRef ? JSON.stringify(input.snapshotRef) : null,
        input.summary ?? null,
        input.error ?? null,
        input.finishReason ?? null,
        input.tokenUsage ? JSON.stringify(input.tokenUsage) : null,
        input.toolsUsed ? JSON.stringify(input.toolsUsed) : null,
        input.skillsUsed ? JSON.stringify(input.skillsUsed) : null,
        input.artifacts ? JSON.stringify(input.artifacts) : null,
      ],
    );
  }

  async findById(id: string): Promise<AgentRunRecord | null> {
    const { rows } = await this.pool.query<RawRow>(`SELECT * FROM agent_runs WHERE id=$1`, [id]);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async listForSession(sessionId: string): Promise<AgentRunRecord[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM agent_runs WHERE session_id=$1 ORDER BY attempt_number ASC`,
      [sessionId],
    );
    return rows.map(rowToRecord);
  }

  async listForTask(taskId: string): Promise<AgentRunRecord[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM agent_runs WHERE task_id=$1 ORDER BY started_at ASC`,
      [taskId],
    );
    return rows.map(rowToRecord);
  }

  async listLive(): Promise<AgentRunRecord[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM agent_runs WHERE status NOT IN ('succeeded','failed') ORDER BY started_at DESC`,
    );
    return rows.map(rowToRecord);
  }

  async listSnapshotRefs(): Promise<AgentRunSnapshotRefRow[]> {
    const { rows } = await this.pool.query<{
      snapshot_id: string;
      task_id: string | null;
      status: AgentRunStatus;
      started_at: unknown;
    }>(
      `SELECT snapshot_ref->>'id' AS snapshot_id,
              task_id,
              status,
              started_at
       FROM agent_runs
       WHERE snapshot_ref IS NOT NULL
         AND snapshot_ref ? 'id'`,
    );
    return rows
      .filter((row): row is typeof row & { snapshot_id: string } => typeof row.snapshot_id === 'string' && row.snapshot_id.length > 0)
      .map((row) => ({
        snapshotId: row.snapshot_id,
        taskId: row.task_id,
        inFlight: row.status !== 'succeeded' && row.status !== 'failed',
        startedAt: iso(row.started_at),
      }));
  }
}
