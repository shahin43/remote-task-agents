import type { SessionRecord, AgentActor } from '@remote-sandbox-agents/contracts';
import type { DatabasePool } from './connection.js';

export interface CreateSessionInput {
  id: string;
  actor: AgentActor;
  parentSessionId: string | null;
  status: string;
  channelOrigin: string | null;
  agentSpecId: string;
  metadata: Record<string, unknown>;
}

/** Thrown when inserting a second live session for the same channel_origin. */
export class UniqueLiveSessionError extends Error {
  readonly code = '23505';
  constructor(public readonly channelOrigin: string | null) {
    super(`live session already exists for channel origin: ${channelOrigin ?? '(null)'}`);
    this.name = 'UniqueLiveSessionError';
  }
}

export function isUniqueLiveSessionError(error: unknown): error is UniqueLiveSessionError {
  if (error instanceof UniqueLiveSessionError) return true;
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: unknown }).code === '23505',
  );
}

export const LIVE_SESSION_STATUSES = new Set(['open', 'routing', 'running']);

export interface ClaimRoutingOptions {
  workerId?: string;
}

export interface SessionsRepo {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findById(id: string): Promise<SessionRecord | null>;
  findByChannelOrigin(channelOrigin: string): Promise<SessionRecord | null>;
  listByActor(actor: 'orchestrator' | 'worker'): Promise<SessionRecord[]>;
  updateStatus(id: string, status: string): Promise<void>;
  touchActivity(id: string): Promise<void>;
  /**
   * Atomically claim the oldest `routing` session for the actor, moving it to
   * `running` with the given lease. Returns null when nothing is claimable.
   * Safe under concurrent claimers (FOR UPDATE SKIP LOCKED in Postgres).
   */
  claimNextRouting(
    actor: 'worker',
    leaseExpiresAt: string,
    opts?: ClaimRoutingOptions,
  ): Promise<SessionRecord | null>;
  /** Sessions still `running` whose lease has expired — presumed crashed. */
  listExpiredRunning(actor: 'worker', now: string): Promise<SessionRecord[]>;
  /** Shallow-merge keys into the session's metadata JSON. */
  mergeMetadata(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Terminal sessions whose worker recorded a completion that control has not projected. */
  listPendingCompletion(): Promise<SessionRecord[]>;
}

export class PgSessionsRepo implements SessionsRepo {
  constructor(private readonly pool: DatabasePool) {}

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const now = new Date().toISOString();
    try {
      await this.pool.query(
        `INSERT INTO sessions(id, actor, parent_session_id, status, channel_origin, agent_spec_id, opened_at, last_activity_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
        [input.id, input.actor, input.parentSessionId, input.status, input.channelOrigin, input.agentSpecId, now, JSON.stringify(input.metadata)],
      );
    } catch (error) {
      if (isUniqueLiveSessionError(error)) {
        throw new UniqueLiveSessionError(input.channelOrigin);
      }
      throw error;
    }
    return {
      id: input.id, actor: input.actor, parentSessionId: input.parentSessionId,
      status: input.status as SessionRecord['status'], channelOrigin: input.channelOrigin,
      agentSpecId: input.agentSpecId, openedAt: now, closedAt: null, lastActivityAt: now,
      leaseExpiresAt: null, leaseOwner: null, leaseGeneration: 0, metadata: input.metadata,
    };
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query<RawRow>(`SELECT * FROM sessions WHERE id = $1`, [id]);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findByChannelOrigin(channelOrigin: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM sessions WHERE channel_origin = $1 ORDER BY opened_at DESC LIMIT 1`, [channelOrigin]);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async listByActor(actor: 'orchestrator' | 'worker'): Promise<SessionRecord[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM sessions WHERE actor = $1 ORDER BY opened_at ASC`, [actor]);
    return rows.map(rowToRecord);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const closing = status === 'closed' || status === 'succeeded' || status === 'failed' || status === 'cancelled';
    const reopening = status === 'routing';
    await this.pool.query(
      `UPDATE sessions
          SET status = $2,
              last_activity_at = now(),
              closed_at = CASE
                WHEN $3::boolean THEN now()
                WHEN $4::boolean THEN NULL
                ELSE closed_at
              END,
              lease_expires_at = CASE WHEN $4::boolean THEN NULL ELSE lease_expires_at END
        WHERE id = $1`,
      [id, status, closing, reopening],
    );
  }

  async touchActivity(id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET last_activity_at = now() WHERE id = $1`, [id]);
  }

  async claimNextRouting(
    actor: 'worker',
    leaseExpiresAt: string,
    opts?: ClaimRoutingOptions,
  ): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query<RawRow>(
      `UPDATE sessions
         SET status = 'running',
             last_activity_at = now(),
             lease_expires_at = $2,
             lease_owner = COALESCE($3, lease_owner),
             lease_generation = COALESCE(lease_generation, 0) + 1
       WHERE id = (
         SELECT id FROM sessions
          WHERE actor = $1 AND status = 'routing'
          ORDER BY opened_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [actor, leaseExpiresAt, opts?.workerId ?? null],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async listExpiredRunning(actor: 'worker', now: string): Promise<SessionRecord[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM sessions
        WHERE actor = $1 AND status = 'running'
          AND lease_expires_at IS NOT NULL AND lease_expires_at < $2
        ORDER BY lease_expires_at ASC`,
      [actor, now],
    );
    return rows.map(rowToRecord);
  }

  async mergeMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET metadata = metadata || $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(patch)],
    );
  }

  async listPendingCompletion(): Promise<SessionRecord[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM sessions
        WHERE status IN ('succeeded', 'failed')
          AND metadata ? 'completionPending'
          AND NOT (metadata ? 'completionProjectedAt')
        ORDER BY last_activity_at ASC`,
    );
    return rows.map(rowToRecord);
  }
}

interface RawRow {
  [key: string]: unknown;
  id: string; actor: AgentActor; parent_session_id: string | null; status: string;
  channel_origin: string | null; agent_spec_id: string; opened_at: unknown;
  closed_at: unknown; last_activity_at: unknown; lease_expires_at: unknown;
  lease_owner: string | null; lease_generation: number | string | null;
  metadata: Record<string, unknown>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

function rowToRecord(row: RawRow): SessionRecord {
  return {
    id: row.id, actor: row.actor, parentSessionId: row.parent_session_id,
    status: row.status as SessionRecord['status'], channelOrigin: row.channel_origin,
    agentSpecId: row.agent_spec_id, openedAt: iso(row.opened_at), closedAt: isoOrNull(row.closed_at),
    lastActivityAt: iso(row.last_activity_at), leaseExpiresAt: isoOrNull(row.lease_expires_at),
    leaseOwner: row.lease_owner ?? null,
    leaseGeneration: row.lease_generation == null ? 0 : Number(row.lease_generation),
    metadata: row.metadata,
  };
}
