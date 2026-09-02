import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAgentProfilesRepo } from './testing/in-memory-agent-profiles-repo.js';

test('AgentProfilesRepo insertVersion increments and getLatest returns newest', async () => {
  const repo = new InMemoryAgentProfilesRepo();
  const v1 = await repo.insertVersion({
    tenantId: 't',
    profileId: 'changelog-writer',
    document: { id: 'changelog-writer' },
    soul: 'v1',
    basePrompt: 'p1',
  });
  assert.equal(v1.version, 1);
  const v2 = await repo.insertVersion({
    tenantId: 't',
    profileId: 'changelog-writer',
    document: { id: 'changelog-writer', n: 2 },
    soul: 'v2',
    basePrompt: 'p2',
  });
  assert.equal(v2.version, 2);
  const latest = await repo.getLatest('t', 'changelog-writer');
  assert.equal(latest?.version, 2);
  assert.equal(latest?.soul, 'v2');
  const listed = await repo.listLatest('t');
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.version, 2);
});
