#!/usr/bin/env node
/**
 * Wipe all task/session state to a clean slate without dropping migrations,
 * users, or registered agents. Useful for local re-runs after botched sessions.
 *
 * Usage:
 *   DATABASE_URL='postgres://remote_agent@127.0.0.1:5433/remote_agent' \
 *     node scripts/cleanup-board-state.mjs [--keep-runs] [--also-runs-folder]
 *
 * --keep-runs           Skip removing the local runs/ artifacts (snapshots, mirrors).
 * --also-runs-folder    Also delete runs/ folder contents (snapshots, mirrors, worktrees).
 */
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const keepRuns = args.has('--keep-runs');
const wipeRunsFolder = args.has('--also-runs-folder');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

/**
 * Tables to truncate. Ordered so children come before parents, even though
 * TRUNCATE ... CASCADE handles FKs — being explicit makes the script readable.
 *
 * Keep: users, agents, schema_versions, session_event_counters seed rows.
 * session_event_counters is recreated on demand by the append trigger, but
 * truncating ensures no stale counters remain after sessions are gone.
 */
const tables = [
  // Hermes session-first
  'agent_runs',
  'session_events',
  'session_event_counters',
  'sessions',
  // Board domain
  'task_events',
  'task_assignments',
  'board_tasks',
];

const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const table of tables) {
    const exists = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [`public.${table}`],
    );
    if (!exists.rows[0].present) {
      console.log(`skip ${table} (not present)`);
      continue;
    }
    await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    console.log(`truncated ${table}`);
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

if (wipeRunsFolder && !keepRuns) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const runsRoot = path.resolve(here, '..', 'runs');
  for (const sub of ['state/snapshots', 'mirrors', 'worktrees', 'restore']) {
    const target = path.join(runsRoot, sub);
    try {
      await fs.rm(target, { recursive: true, force: true });
      console.log(`removed ${target}`);
    } catch (err) {
      console.warn(`could not remove ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

console.log('cleanup complete.');
