import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabasePool } from './connection.js';
import { runMigrations } from './migrate.js';

class FakePool implements DatabasePool {
  public log: { text: string; values?: unknown[] }[] = [];
  public versionsRows: { name: string }[] = [];
  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }> {
    this.log.push({ text, values });
    if (text.includes('FROM schema_versions')) {
      return { rows: this.versionsRows as unknown as R[], rowCount: this.versionsRows.length };
    }
    return { rows: [] as R[], rowCount: 0 };
  }
  async close(): Promise<void> {}
}

test('runMigrations creates schema_versions table when first run', async () => {
  const pool = new FakePool();
  await runMigrations(pool);
  const first = pool.log[0]?.text ?? '';
  assert.ok(first.includes('CREATE TABLE IF NOT EXISTS schema_versions'));
});

test('runMigrations skips files already in schema_versions', async () => {
  const pool = new FakePool();
  pool.versionsRows = [
    { name: '0001_sessions_init.sql' },
    { name: '0002_session_event_counters.sql' },
    { name: '0003_worker_leases.sql' },
    { name: '0004_board_init.sql' },
    { name: '0005_agent_runs.sql' },
    { name: '0006_drop_remote_agent_legacy.sql' },
    { name: '0007_agent_runs_guest_image.sql' },
    { name: '0008_agent_runs_skills_used.sql' },
    { name: '0009_live_session_ownership.sql' },
    { name: '0010_agent_profiles.sql' },
  ];
  await runMigrations(pool);
  const ran = pool.log.filter((q) => q.text.includes('-- migration:'));
  assert.equal(ran.length, 0);
});

test('runMigrations applies and records new migrations under an advisory lock', async () => {
  const pool = new FakePool();
  await runMigrations(pool);
  const applied = pool.log.find((q) => q.text.includes('-- migration:0001_sessions_init.sql'));
  assert.ok(applied, 'expected the 0001 migration to be applied');
  assert.ok(applied!.text.includes('pg_advisory_xact_lock'), 'migration must take the advisory lock');
  assert.ok(
    applied!.text.includes(`INSERT INTO schema_versions(name) VALUES ('0001_sessions_init.sql') ON CONFLICT (name) DO NOTHING`),
    'expected migration to be recorded idempotently in the same transaction',
  );
});
