import type { SessionEventRecord } from '@remote-sandbox-agents/contracts';
import type { DatabasePool } from './connection.js';

export interface AppendEventInput {
  sessionId: string;
  eventType: SessionEventRecord['eventType'];
  kind: string;
  payload: unknown;
}

export interface SessionEventsRepo {
  append(input: AppendEventInput): Promise<SessionEventRecord>;
  list(sessionId: string, fromIndex?: number): Promise<SessionEventRecord[]>;
  fetchByIndex(sessionId: string, eventIndex: number): Promise<SessionEventRecord | null>;
}

export class PgSessionEventsRepo implements SessionEventsRepo {
  constructor(private readonly pool: DatabasePool) {}

  async append(input: AppendEventInput): Promise<SessionEventRecord> {
    // Index assignment must be atomic. The old read-then-insert (MAX(event_index)+1) raced:
    // concurrent appends to the SAME session (e.g. the agent engine's fire-and-forget event
    // stream) read the same MAX and collided on the (session_id, event_index) primary key.
    //
    // Fix: a per-session counter row bumped with INSERT ... ON CONFLICT DO UPDATE. The upsert
    // takes a row lock that serializes concurrent same-session appends across all pool
    // connections and worker processes; the data-modifying CTE's RETURNING feeds the event
    // INSERT in the SAME statement (guaranteed atomic — unlike CTE advisory-lock ordering).
    // Different sessions never contend (distinct counter rows). O(1): no MAX scan.
    const { rows } = await this.pool.query<RawRow>(
      `WITH seq AS (
         INSERT INTO session_event_counters (session_id, next_index)
         VALUES ($1, 1)
         ON CONFLICT (session_id)
           DO UPDATE SET next_index = session_event_counters.next_index + 1
         RETURNING next_index - 1 AS i
       )
       INSERT INTO session_events(session_id, event_index, event_type, kind, payload)
       SELECT $1, seq.i, $2, $3, $4::jsonb FROM seq
       RETURNING session_id, event_index, event_type, kind, payload, created_at`,
      [input.sessionId, input.eventType, input.kind, JSON.stringify(input.payload)],
    );
    return rowToRecord(rows[0]!);
  }

  async list(sessionId: string, fromIndex = 0): Promise<SessionEventRecord[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM session_events WHERE session_id = $1 AND event_index >= $2 ORDER BY event_index ASC`,
      [sessionId, fromIndex],
    );
    return rows.map(rowToRecord);
  }

  async fetchByIndex(sessionId: string, eventIndex: number): Promise<SessionEventRecord | null> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM session_events WHERE session_id = $1 AND event_index = $2`,
      [sessionId, eventIndex],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }
}

interface RawRow {
  session_id: string;
  event_index: number | string;
  event_type: SessionEventRecord['eventType'];
  kind: string;
  payload: unknown;
  created_at: unknown;
  [key: string]: unknown;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function rowToRecord(row: RawRow): SessionEventRecord {
  return {
    sessionId: row.session_id,
    eventIndex: typeof row.event_index === 'string' ? Number(row.event_index) : row.event_index,
    eventType: row.event_type,
    kind: row.kind,
    payload: row.payload,
    createdAt: iso(row.created_at),
  };
}
