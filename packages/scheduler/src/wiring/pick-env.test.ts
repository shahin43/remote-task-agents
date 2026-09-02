import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEnv, PI_RUNNER_ENV_KEYS } from './pick-env.js';

test('pickEnv copies only the listed keys that are set', () => {
  const source = { PATH: '/bin', OPENAI_API_KEY: 'sk-1', LINEAR_API_KEY: 'lin-secret' };
  const out = pickEnv(['PATH', 'OPENAI_API_KEY'], source);
  assert.deepEqual(out, { PATH: '/bin', OPENAI_API_KEY: 'sk-1' });
});

test('pickEnv omits keys not present in the source', () => {
  const out = pickEnv(['PATH', 'OPENAI_API_KEY'], { PATH: '/bin' });
  assert.deepEqual(out, { PATH: '/bin' });
});

test('pickEnv never copies unrelated credentials through the allowlist', () => {
  const source = {
    PATH: '/bin', HOME: '/home/x', OPENAI_API_KEY: 'sk-1',
    LINEAR_API_KEY: 'lin-secret', GIT_TOKEN: 'secret', DATABASE_URL: 'postgres://secret',
  };
  const out = pickEnv(PI_RUNNER_ENV_KEYS, source);
  assert.ok(!('LINEAR_API_KEY' in out));
  assert.ok(!('GIT_TOKEN' in out));
  assert.ok(!('DATABASE_URL' in out));
  assert.equal(out.OPENAI_API_KEY, 'sk-1');
});
