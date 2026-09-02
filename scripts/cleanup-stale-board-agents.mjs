#!/usr/bin/env node
/**
 * One-shot cleanup for the 2026-06-29 agent profile cleanup.
 *
 * Reconciles the `agents` table with the new `coder` + `reviewer` profile
 * shape from `ensureBoardDevPrincipals` and the 2026-06-29 profile rename
 * (commit 290d236). Safe to re-run; each step is idempotent.
 *
 *   - Upsert `agent-coder`    → profile_id=coder,    display=Coder
 *   - Upsert `agent-reviewer` → profile_id=reviewer, display=Reviewer
 *   - Migrate any OPEN task_assignments + board_tasks.assignee_id from the
 *     legacy `agent-reviewer-agent` → `agent-reviewer`, emitting a
 *     `reassigned` task_event per task for audit clarity.
 *   - Delete known-orphan agent rows: `agent-reviewer-agent` and any agent
 *     row whose id matches the `a-<digits>-<digits>` pattern from old
 *     synthetic-project e2e runs that has no open assignments.
 *   - Delete entire orphan synthetic-project chains: every row in
 *     `board_tasks` whose `project_id` matches `p-<digits>-<digits>` (the
 *     auto-generated per-run project id from old e2e fixtures). CASCADE on
 *     `task_id` clears `task_assignments` and `task_events` automatically.
 *   - Do NOT touch user-created agents or tasks under the real project_id.
 *
 * Usage:
 *   DATABASE_URL='postgres://remote_agent@127.0.0.1:5433/remote_agent' \
 *     node scripts/cleanup-stale-board-agents.mjs [--dry-run]
 *
 * --dry-run   Report what would change without writing.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const dryRun = process.argv.includes('--dry-run');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const tenantId = process.env.REMOTE_AGENT_BOARD_TENANT_ID ?? 'default';
const projectId = process.env.REMOTE_AGENT_BOARD_PROJECT_ID ?? 'sample/service';

const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();

const log = (...args) => console.log(dryRun ? '[dry-run]' : '         ', ...args);

try {
  await client.query('BEGIN');

  // 1) Upsert the canonical principals (mirrors ensureBoardDevPrincipals).
  if (!dryRun) {
    await client.query(
      `INSERT INTO agents(id, tenant_id, project_id, profile_id, display_name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id,
         profile_id=EXCLUDED.profile_id, display_name=EXCLUDED.display_name`,
      ['agent-coder', tenantId, projectId, 'coder', 'Coder'],
    );
    await client.query(
      `INSERT INTO agents(id, tenant_id, project_id, profile_id, display_name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id,
         profile_id=EXCLUDED.profile_id, display_name=EXCLUDED.display_name`,
      ['agent-reviewer', tenantId, projectId, 'reviewer', 'Reviewer'],
    );
  }
  log('upserted agent-coder (profile=coder) and agent-reviewer (profile=reviewer)');

  // 2) Migrate OPEN assignments + denormalised board_tasks rows for the
  //    legacy `agent-reviewer-agent` → `agent-reviewer`.
  const { rows: openAssignments } = await client.query(
    `SELECT id, task_id FROM task_assignments
     WHERE assignee_kind='agent' AND assignee_id='agent-reviewer-agent'
       AND unassigned_at IS NULL`,
  );

  log(`found ${openAssignments.length} OPEN assignments held by legacy 'agent-reviewer-agent'`);

  for (const row of openAssignments) {
    if (!dryRun) {
      await client.query(
        `UPDATE task_assignments SET assignee_id='agent-reviewer' WHERE id=$1`,
        [row.id],
      );
      await client.query(
        `UPDATE board_tasks SET assignee_id='agent-reviewer', updated_at=NOW()
         WHERE id=$1 AND assignee_kind='agent' AND assignee_id='agent-reviewer-agent'`,
        [row.task_id],
      );
      await client.query(
        `INSERT INTO task_events(id, task_id, kind, actor, payload, created_at)
         VALUES ($1, $2, 'reassigned', 'cleanup-script-2026-06-29', $3, NOW())`,
        [
          randomUUID(),
          row.task_id,
          JSON.stringify({
            from: { kind: 'agent', id: 'agent-reviewer-agent' },
            to:   { kind: 'agent', id: 'agent-reviewer' },
            reason: 'Legacy id renamed during 2026-06-29 agent profile cleanup',
          }),
        ],
      );
    }
    log(`  task ${row.task_id}: agent-reviewer-agent → agent-reviewer`);
  }

  // 3) Delete dead agent rows.
  //    (a) the legacy 'agent-reviewer-agent' — only after its open work was
  //        migrated above. Historical (closed) task_assignments rows still
  //        reference the old id; that's intentional audit history.
  //    (b) any 'a-<digits>-<digits>' rows whose project_id is a synthetic
  //        'p-<digits>-<digits>' from old live-e2e runs, with zero open
  //        assignments. Never touch agents in the main project_id.
  const orphanFilter = `
    id ~ '^a-[0-9]+-[0-9]+$'
    AND project_id ~ '^p-[0-9]+-[0-9]+$'
    AND id NOT IN (SELECT DISTINCT assignee_id FROM task_assignments
                   WHERE assignee_kind='agent' AND unassigned_at IS NULL)
  `;

  const { rows: orphans } = await client.query(
    `SELECT id, profile_id, display_name, project_id FROM agents WHERE ${orphanFilter} ORDER BY id`,
  );
  log(`found ${orphans.length} orphan agent rows on synthetic project_ids:`);
  for (const o of orphans) log(`  ${o.id} (profile=${o.profile_id}, project=${o.project_id})`);

  if (!dryRun) {
    await client.query(`DELETE FROM agents WHERE ${orphanFilter}`);
    const { rowCount: legacyDeleted } = await client.query(
      `DELETE FROM agents WHERE id='agent-reviewer-agent'`,
    );
    if (legacyDeleted) log(`deleted legacy 'agent-reviewer-agent' agent row`);
  } else {
    log(`would delete 'agent-reviewer-agent' agent row (legacy id)`);
  }

  // 4) Sweep orphan synthetic-project chains. These are entire mini-boards
  //    auto-created by old `live-board-follow-up-e2e.sh` runs (per-run
  //    timestamp project_ids) that were never cleaned up. The FK from
  //    task_assignments + task_events to board_tasks is ON DELETE CASCADE,
  //    so deleting the tasks reaps the assignments and events.
  const { rows: orphanTasks } = await client.query(
    `SELECT id, project_id, title, status FROM board_tasks
     WHERE project_id ~ '^p-[0-9]+-[0-9]+\$' ORDER BY project_id, id`,
  );
  log(`found ${orphanTasks.length} orphan tasks on synthetic project_ids:`);
  for (const t of orphanTasks) {
    log(`  task ${t.id} [${t.status}] "${t.title}" on ${t.project_id}`);
  }
  if (!dryRun) {
    const { rowCount: tasksDeleted } = await client.query(
      `DELETE FROM board_tasks WHERE project_id ~ '^p-[0-9]+-[0-9]+\$'`,
    );
    log(`deleted ${tasksDeleted} orphan task chains (assignments+events CASCADEd)`);
  }

  await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  log(dryRun ? 'dry run rolled back. No writes performed.' : 'cleanup complete.');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
