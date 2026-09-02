import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerProfileLoader } from './worker-profile-loader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/spec → repo root (serviceDefaultRoot contains agents/<id>/)
const assetsRoot = path.resolve(here, '../../../..');

test('lists the shipped worker profiles (author + coder + reviewer)', async () => {
  const loader = new WorkerProfileLoader({ assetsRoot });
  const profiles = await loader.list();
  const ids = profiles.map((p) => p.id).sort();
  assert.deepEqual(ids, ['author', 'coder', 'reviewer']);
});

test('reviewer loads as a pi-agent worker profile', async () => {
  const loader = new WorkerProfileLoader({ assetsRoot });
  const profile = await loader.get('reviewer');
  assert.equal(profile.id, 'reviewer');
  assert.equal(profile.engine, 'pi-agent');
  assert.equal(profile.runtime, 'sandbox-docker');
  assert.equal(profile.workspaceRetention, 'delete-on-success');
});

test('author loads as a pi-agent worker profile with document skills and no repos', async () => {
  const loader = new WorkerProfileLoader({ assetsRoot });
  const profile = await loader.get('author');
  assert.equal(profile.id, 'author');
  assert.equal(profile.engine, 'pi-agent');
  assert.equal(profile.runtime, 'sandbox-docker');
  assert.equal(profile.workspaceRetention, 'delete-on-success');
  assert.deepEqual(profile.skills.names ?? [], ['business-paper', 'chart']);
  assert.deepEqual(profile.scopePolicy?.allowedRepos ?? [], []);
});

test('coder loads as a pi-agent worker profile with editing-grade limits', async () => {
  const loader = new WorkerProfileLoader({ assetsRoot });
  const profile = await loader.get('coder');
  assert.equal(profile.id, 'coder');
  assert.equal(profile.engine, 'pi-agent');
  assert.equal(profile.runtime, 'sandbox-docker');
  assert.equal(profile.workspaceRetention, 'delete-on-success');
  // coder gets more headroom than reviewer (it actually edits)
  assert.ok(profile.limits.maxToolCalls >= 100, 'coder needs room for read + edit + tests');
});
