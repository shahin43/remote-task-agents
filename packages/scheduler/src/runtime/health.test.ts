import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHealthServer } from './health.js';

test('health server reports live and ready independently', async () => {
  let ready = false;
  const handle = await startHealthServer(() => ({ live: true, ready }));
  try {
    const live = await fetch(`http://127.0.0.1:${handle.port}/live`);
    assert.equal(live.status, 200);
    const notReady = await fetch(`http://127.0.0.1:${handle.port}/ready`);
    assert.equal(notReady.status, 503);
    ready = true;
    const ok = await fetch(`http://127.0.0.1:${handle.port}/ready`);
    assert.equal(ok.status, 200);
  } finally {
    await handle.close();
  }
});
