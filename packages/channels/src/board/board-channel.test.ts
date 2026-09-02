import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardChannel } from './board-channel.js';

test('BoardChannel.conversationKey builds the canonical board key', () => {
  const channel = new BoardChannel();
  assert.equal(channel.id, 'board');
  assert.equal(channel.conversationKey({ projectId: 'proj', taskId: 'task-1' }), 'board:v1:proj:task-1');
});

test('BoardChannel.parseConversationKey round-trips a board key', () => {
  const channel = new BoardChannel();
  assert.deepEqual(channel.parseConversationKey('board:v1:proj:task-1'), { projectId: 'proj', taskId: 'task-1' });
});

test('BoardChannel.parseConversationKey returns null for a non-board key', () => {
  const channel = new BoardChannel();
  assert.equal(channel.parseConversationKey('slack:v1:team:thread'), null);
});
