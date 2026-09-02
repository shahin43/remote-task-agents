#!/usr/bin/env node
/**
 * Fail a worker session stuck in `running` and move its board task to `failed`.
 *
 * Usage:
 *   DATABASE_URL='postgres://remote_agent@127.0.0.1:5433/remote_agent' \
 *     node scripts/reset-stuck-board-session.mjs <session-id>
 *
 * Optional: pass --force to reset even when the lease has not expired yet.
 */
import pg from 'pg';
import crypto from 'node:crypto';

const sessionId = process.argv[2];
const force = process.argv.includes('--force');

if (!sessionId || sessionId.startsWith('-')) {
  console.error('Usage: node scripts/reset-stuck-board-session.mjs <session-id> [--force]');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const { rows } = await pool.query(
    `SELECT id, status, lease_expires_at, channel_origin, metadata
       FROM sessions
      WHERE id = $1`,
    [sessionId],
  );
  const session = rows[0];
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  if (session.status !== 'running' && session.status !== 'routing') {
    console.error(`Session ${sessionId} is ${session.status}, not stuck in running/routing.`);
    process.exit(1);
  }
  if (
    !force &&
    session.lease_expires_at &&
    new Date(session.lease_expires_at).getTime() > Date.now()
  ) {
    console.error(
      `Lease still active until ${session.lease_expires_at}. Re-run with --force to reset anyway.`,
    );
    process.exit(1);
  }

  const taskId = session.metadata?.boardTaskId ?? null;
  const error = 'Manually reset: worker session was stuck in running.';

  await pool.query('BEGIN');
  await pool.query(
    `UPDATE sessions
        SET status = 'failed',
            closed_at = now(),
            lease_expires_at = NULL,
            last_activity_at = now()
      WHERE id = $1`,
    [sessionId],
  );

  const { rows: eventRows } = await pool.query(
    `SELECT COALESCE(MAX(event_index), -1) + 1 AS next_index FROM session_events WHERE session_id = $1`,
    [sessionId],
  );
  const nextIndex = eventRows[0].next_index;

  await pool.query(
    `INSERT INTO session_events (session_id, event_index, event_type, kind, payload)
     VALUES ($1, $2, 'turn', 'worker_end', $3::jsonb)`,
    [sessionId, nextIndex, JSON.stringify({ status: 'failed', summary: error, durationMs: 0, error })],
  );

  if (taskId) {
    await pool.query(
      `UPDATE board_tasks SET status = 'failed', updated_at = now() WHERE id = $1`,
      [taskId],
    );
    await pool.query(
      `INSERT INTO task_events (id, task_id, kind, actor, payload)
       VALUES ($1, $2, 'status_changed', 'operator-reset', $3::jsonb)`,
      [crypto.randomUUID(), taskId, JSON.stringify({ from: 'working', to: 'failed' })],
    );
    await pool.query(
      `INSERT INTO task_events (id, task_id, kind, actor, payload)
       VALUES ($1, $2, 'commented', 'operator-reset', $3::jsonb)`,
      [crypto.randomUUID(), taskId, JSON.stringify({ text: error })],
    );
  }

  await pool.query('COMMIT');
  console.log(`Reset session ${sessionId}${taskId ? ` and task ${taskId}` : ''} to failed.`);
} catch (err) {
  await pool.query('ROLLBACK').catch(() => {});
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  await pool.end();
}
