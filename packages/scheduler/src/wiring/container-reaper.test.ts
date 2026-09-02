import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reapOrphanContainers } from './container-reaper.js';

test('reapOrphanContainers removes containers matched by the project label', async () => {
  const calls: string[][] = [];
  const ids = await reapOrphanContainers({
    dockerBin: '/usr/bin/docker',
    exec: async (bin, args) => {
      calls.push([bin, ...args]);
      return { stdout: args[0] === 'ps' ? 'abc123\ndef456\n' : '' };
    },
  });
  assert.deepEqual(ids, ['abc123', 'def456']);
  assert.deepEqual(calls[0], ['/usr/bin/docker', 'ps', '-aq', '--filter', 'label=project=remote-sandbox-agents']);
  assert.deepEqual(calls[1], ['/usr/bin/docker', 'rm', '-f', 'abc123', 'def456']);
});

test('reapOrphanContainers is a no-op when nothing matches', async () => {
  const calls: string[][] = [];
  const ids = await reapOrphanContainers({
    dockerBin: 'docker',
    exec: async (bin, args) => {
      calls.push([bin, ...args]);
      return { stdout: '\n' };
    },
  });
  assert.deepEqual(ids, []);
  assert.equal(calls.length, 1, 'must not call docker rm with no ids');
});

test('reapOrphanContainers swallows docker failures (daemon down, binary missing)', async () => {
  const ids = await reapOrphanContainers({
    dockerBin: 'docker',
    exec: async () => { throw new Error('Cannot connect to the Docker daemon'); },
  });
  assert.deepEqual(ids, []);
});
