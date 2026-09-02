import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentBus, AgentBusPublishInput, SessionEventRecord } from '@remote-sandbox-agents/contracts';
import { channelInputEvent, publishChannelInput } from './shared.js';

test('channelInputEvent normalizes a ChannelInput into a channel.input session event', () => {
  const event = channelInputEvent('sess-1', {
    conversationKey: 'board:v1:proj:task-1',
    text: 'do the thing',
    payload: { boardTaskId: 'task-1' },
  });
  assert.equal(event.sessionId, 'sess-1');
  assert.equal(event.eventType, 'input');
  assert.equal(event.kind, 'channel.input');
  assert.deepEqual(event.payload, { text: 'do the thing', boardTaskId: 'task-1' });
});

test('publishChannelInput publishes the normalized event onto the bus', async () => {
  const published: AgentBusPublishInput[] = [];
  const bus: AgentBus = {
    publish: async (event) => {
      published.push(event);
      return { ...event, eventIndex: 0, createdAt: 'now' } as SessionEventRecord;
    },
    subscribe: async () => async () => {},
    replay: async function* () {},
  };

  await publishChannelInput(bus, 'sess-2', { conversationKey: 'k', text: 'hi' });

  assert.equal(published.length, 1);
  assert.equal(published[0]!.kind, 'channel.input');
  assert.deepEqual(published[0]!.payload, { text: 'hi' });
});
