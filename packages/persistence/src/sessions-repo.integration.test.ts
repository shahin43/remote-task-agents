import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgPool } from './connection.js';
import { runMigrations } from './migrate.js';
import { PgSessionsRepo } from './sessions-repo.js';

const databaseUrl = process.env.DATABASE_URL;
const skip = !databaseUrl ? 'DATABASE_URL not set' : undefined;

test('concurrent claimNextRouting never double-claims a session (FOR UPDATE SKIP LOCKED)', { skip }, async () => {
  const pool = new PgPool(databaseUrl!);
  await runMigrations(pool);
  const sessions = new PgSessionsRepo(pool);

  const stamp = `${Date.now()}-${Math.floor(performance.now())}`;
  const ids = Array.from({ length: 5 }, (_unused, i) => `claim-race-${stamp}-${i}`);
  for (const id of ids) {
    await sessions.create({
      id, actor: 'worker', parentSessionId: null, status: 'routing',
      channelOrigin: null, agentSpecId: 'coding-default', metadata: {},
    });
  }

  try {
    const lease = new Date(Date.now() + 60_000).toISOString();
    // More concurrent claimers than claimable sessions.
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => sessions.claimNextRouting('worker', lease)),
    );
    const claimed = claims.filter((c): c is NonNullable<typeof c> => c !== null)
      .filter((c) => ids.includes(c.id));

    const uniqueIds = new Set(claimed.map((c) => c.id));
    assert.equal(uniqueIds.size, claimed.length, 'no session claimed twice');
    for (const c of claimed) {
      assert.equal(c.status, 'running');
      assert.equal(c.leaseExpiresAt !== null, true);
    }

    // Drain whatever is left (other routing rows may exist in a shared dev DB),
    // then verify all our sessions ended up claimed exactly once.
    while (await sessions.claimNextRouting('worker', lease)) { /* drain */ }
    for (const id of ids) {
      const row = await sessions.findById(id);
      assert.equal(row?.status, 'running');
    }

    // Expired-lease sweep query sees nothing yet (leases are in the future).
    const expired = await sessions.listExpiredRunning('worker', new Date().toISOString());
    assert.equal(expired.some((e) => ids.includes(e.id)), false);
  } finally {
    await pool.close();
  }
});
