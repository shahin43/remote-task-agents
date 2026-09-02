import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardConversationKey, parseBoardConversationKey } from './conversation-key.js';

test('boardConversationKey builds board:v1:<project>:<task>', () => {
  assert.equal(boardConversationKey('proj-1', 'task-42'), 'board:v1:proj-1:task-42');
});

test('parseBoardConversationKey round-trips', () => {
  const key = boardConversationKey('proj-1', 'd9f-uuid-task');
  assert.deepEqual(parseBoardConversationKey(key), { projectId: 'proj-1', taskId: 'd9f-uuid-task' });
});

test('parseBoardConversationKey tolerates colons in the task id', () => {
  assert.deepEqual(parseBoardConversationKey('board:v1:p:a:b'), { projectId: 'p', taskId: 'a:b' });
});

test('parseBoardConversationKey returns null for non-board keys', () => {
  assert.equal(parseBoardConversationKey('cli:abc'), null);
  assert.equal(parseBoardConversationKey('board:v2:p:t'), null);
  assert.equal(parseBoardConversationKey('board:v1:p'), null);
});
