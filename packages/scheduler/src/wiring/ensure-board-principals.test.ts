import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryBoardStore } from '@remote-sandbox-agents/persistence';
import { ensureBoardDevPrincipals } from './ensure-board-principals.js';

test('ensureBoardDevPrincipals seeds the coder + reviewer pair plus the human operator', async () => {
  const board = new InMemoryBoardStore();
  await ensureBoardDevPrincipals({ board, tenantId: 't1', projectId: 'proj' });

  const coder = await board.getAgent('agent-coder');
  const reviewer = await board.getAgent('agent-reviewer');
  const author = await board.getAgent('agent-author');
  assert.equal(coder?.profileId, 'coder', 'agent-coder defaults to the coder profile');
  assert.equal(reviewer?.profileId, 'reviewer', 'agent-reviewer is pinned to the reviewer profile');
  assert.equal(author?.profileId, 'author', 'agent-author is pinned to the author profile');
  assert.equal((await board.listUsers('proj')).length, 1);
});

test('ensureBoardDevPrincipals overrides agent-coder profile via defaultAgentProfileId, leaves reviewer alone', async () => {
  const board = new InMemoryBoardStore();
  await ensureBoardDevPrincipals({
    board,
    tenantId: 't1',
    projectId: 'proj',
    defaultAgentProfileId: 'custom-coder',
  });
  assert.equal((await board.getAgent('agent-coder'))?.profileId, 'custom-coder');
  assert.equal((await board.getAgent('agent-reviewer'))?.profileId, 'reviewer');
});

test('ensureBoardDevPrincipals updates an existing legacy agent row to the new defaults', async () => {
  const board = new InMemoryBoardStore();
  await board.upsertAgent({
    id: 'agent-coder',
    tenantId: 't1',
    projectId: 'proj',
    profileId: 'coding-default',
    displayName: 'Old Coder',
  });

  await ensureBoardDevPrincipals({ board, tenantId: 't1', projectId: 'proj' });
  assert.equal((await board.getAgent('agent-coder'))?.profileId, 'coder');
});
