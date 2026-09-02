import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySessionEventsRepo } from './testing/in-memory-session-events-repo.js';
import { InMemoryAgentBus } from './agent-bus.js';

test('publish appends event, assigns monotonic index, and delivers to subscribers', async () => {
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const seen: number[] = [];
  await bus.subscribe('s1', (e) => seen.push(e.eventIndex));
  await bus.publish({ sessionId: 's1', eventType: 'input', kind: 'channel.input', payload: { a: 1 } });
  await bus.publish({ sessionId: 's1', eventType: 'action', kind: 'tool_call.dispatch_job', payload: { b: 2 } });
  assert.deepEqual(seen, [0, 1]);
});

test('replay returns events from a starting index', async () => {
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  for (let i = 0; i < 3; i++) {
    await bus.publish({ sessionId: 's1', eventType: 'input', kind: 'k', payload: { i } });
  }
  const collected: number[] = [];
  for await (const e of bus.replay('s1', 1)) collected.push(e.eventIndex);
  assert.deepEqual(collected, [1, 2]);
});

test('unsubscribe stops delivery', async () => {
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  let count = 0;
  const off = await bus.subscribe('s1', () => count++);
  await bus.publish({ sessionId: 's1', eventType: 'input', kind: 'k', payload: {} });
  await off();
  await bus.publish({ sessionId: 's1', eventType: 'input', kind: 'k', payload: {} });
  assert.equal(count, 1);
});
