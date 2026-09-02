import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabasePool } from './connection.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Arbitrary project-unique key for the migration advisory lock. */
const MIGRATION_LOCK_KEY = 730013002;

export async function runMigrations(pool: DatabasePool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_versions (
       name        TEXT PRIMARY KEY,
       applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await pool.query<{ name: string }>(`SELECT name FROM schema_versions`);
  const applied = new Set(rows.map((r) => r.name));

  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    if (!/^[\w.-]+$/.test(file)) {
      throw new Error(`Refusing migration with unsafe filename: ${file}`);
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // One multi-statement query = one implicit transaction on one connection.
    // The xact-scoped advisory lock serializes concurrent migrators (multiple
    // processes starting at once); since every migration is idempotent
    // (IF NOT EXISTS / ON CONFLICT DO NOTHING) and the version insert is too,
    // a racing second applier becomes a clean no-op. The filename must be
    // inlined because multi-statement queries cannot carry bind parameters —
    // it is repo-controlled and validated above, not user input.
    await pool.query(
      `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY});\n` +
      `-- migration:${file}\n${sql}\n` +
      `INSERT INTO schema_versions(name) VALUES ('${file}') ON CONFLICT (name) DO NOTHING;`,
    );
  }
}
