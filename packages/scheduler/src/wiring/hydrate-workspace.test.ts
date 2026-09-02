import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { overlayHydratedSnapshot } from './hydrate-workspace.js';

test('overlayHydratedSnapshot copies onto host workspaceRoot for unix-local', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrate-unix-'));
  const staging = path.join(root, 'staging');
  const live = path.join(root, 'workspace');
  await fs.mkdir(path.join(staging, 'repo'), { recursive: true });
  await fs.writeFile(path.join(staging, 'repo', 'note.md'), 'hydrated\n');
  await fs.mkdir(live, { recursive: true });

  await overlayHydratedSnapshot({
    stagingDir: staging,
    session: {
      state: { type: 'unix_local', sessionId: 's', workspaceRoot: live },
    },
  });

  assert.equal(await fs.readFile(path.join(live, 'repo', 'note.md'), 'utf8'), 'hydrated\n');
});

test('overlayHydratedSnapshot uses docker cp for docker sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrate-dock-'));
  const staging = path.join(root, 'staging');
  await fs.mkdir(staging, { recursive: true });
  await fs.writeFile(path.join(staging, 'x.txt'), 'in-container\n');
  const cps: Array<{ src: string; containerId: string; dest: string }> = [];

  await overlayHydratedSnapshot({
    stagingDir: staging,
    session: {
      state: {
        type: 'docker',
        sessionId: 's',
        workspaceRoot: '/workspace',
        containerId: 'abc123',
        manifestRoot: '/workspace',
      },
    },
    dockerCp: async (src, containerId, dest) => {
      cps.push({ src, containerId, dest });
    },
  });

  assert.equal(cps.length, 1);
  assert.equal(cps[0]!.src, staging);
  assert.equal(cps[0]!.containerId, 'abc123');
  assert.equal(cps[0]!.dest, '/workspace');
});
