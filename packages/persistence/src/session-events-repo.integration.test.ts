import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgPool } from './connection.js';
import { runMigrations } from './migrate.js';
import { PgSessionsRepo } from './sessions-repo.js';
import { PgSessionEventsRepo } from './session-events-repo.js';

const databaseUrl = process.env.DATABASE_URL;
const skip = !databaseUrl ? 'DATABASE_URL not set' : undefined;

test('concurrent appends to one session get unique, contiguous indices (no 23505 race)', { skip }, async () => {
  const pool = new PgPool(databaseUrl!);
  await runMigrations(pool);
  const sessions = new PgSessionsRepo(pool);
  const events = new PgSessionEventsRepo(pool);

  const sessionId = `evt-race-${Date.now()}-${Math.floor(performance.now())}`;
  await sessions.create({
    id: sessionId, actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin: null, agentSpecId: 'coding-default', metadata: {},
  });

  try {
    // Fire many appends concurrently (un-awaited individually) — this is the agent
    // fire-and-forget emit pattern that exposed the read-then-insert race.
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, (_unused, k) =>
        events.append({ sessionId, eventType: 'system', kind: `engine.message.${k}`, payload: { k } }),
      ),
    );

    const indices = results.map((r) => r.eventIndex).sort((a, b) => a - b);
    const expected = Array.from({ length: N }, (_unused, i) => i);
    assert.deepEqual(indices, expected, 'indices must be exactly 0..N-1 with no gaps or duplicates');

    // And the persisted rows agree.
    const listed = await events.list(sessionId);
    assert.equal(listed.length, N, 'all N events persisted');
  } finally {
    await pool.close();
  }
});
