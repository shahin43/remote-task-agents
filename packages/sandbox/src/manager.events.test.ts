import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SandboxManager } from './manager.js';
import { LocalSnapshotStore } from './snapshot/local-snapshot.js';
import { FakeSandboxProvider } from './testing/fake-provider.js';
import { createManifest } from './manifest.js';
import type { SandboxEventSink } from './events.js';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

test('SandboxManager emits sandbox.* lifecycle events to the sink', async () => {
  const events: string[] = [];
  const sink: SandboxEventSink = { async emit(type) { events.push(type); } };
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const manager = new SandboxManager({
    providers: [new FakeSandboxProvider()],
    snapshotStore: new LocalSnapshotStore({ root: snapRoot }),
    clock: () => '2026-06-06T00:00:00.000Z',
  });
  const manifest = createManifest({ entries: {}, env: {} });
  const session = await manager.create({ manifest, options: { type: 'fake' } }, sink);
  await manager.snapshot(session, {}, sink);
  await manager.destroy(session, sink);
  assert.ok(events.includes('sandbox.container.created'), `got: ${events.join(',')}`);
  assert.ok(events.includes('sandbox.container.started'));
  assert.ok(events.includes('sandbox.snapshot.persisted'));
  assert.ok(events.includes('sandbox.container.destroyed'));
});

test('emitted payloads are rich SandboxEventPayloads (phase/backend/at + container + timing)', async () => {
  const payloads: Array<{ type: string; payload: any }> = [];
  const sink: SandboxEventSink = { async emit(type, payload) { payloads.push({ type, payload }); } };
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const manager = new SandboxManager({
    providers: [new FakeSandboxProvider()],
    snapshotStore: new LocalSnapshotStore({ root: snapRoot }),
    clock: () => '2026-06-06T00:00:00.000Z',
  });
  const session = await manager.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'fake' } }, sink);

  const created = payloads.find((p) => p.type === 'sandbox.container.created')!;
  assert.equal(created.payload.phase, 'created');
  assert.equal(created.payload.backend, 'fake');
  assert.equal(created.payload.at, '2026-06-06T00:00:00.000Z');
  assert.equal(created.payload.sessionId, session.state.sessionId);

  const started = payloads.find((p) => p.type === 'sandbox.container.started')!;
  assert.equal(typeof started.payload.durationMs, 'number'); // timed phase
  // FakeSandboxProvider stamps a container.id into state; manager projects it onto the payload.
  assert.ok(started.payload.container && typeof started.payload.container.id === 'string');

  const matz = payloads.find((p) => p.type === 'sandbox.manifest.materializing')!;
  assert.equal(matz.payload.detail.entries, 0);
});

test('a failing phase emits sandbox.error then rethrows', async () => {
  const types: string[] = [];
  const sink: SandboxEventSink = { async emit(type) { types.push(type); } };
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const provider = new FakeSandboxProvider();
  // Force start() to throw for this session.
  provider.failStart = true;
  const manager = new SandboxManager({
    providers: [provider],
    snapshotStore: new LocalSnapshotStore({ root: snapRoot }),
    clock: () => '2026-06-06T00:00:00.000Z',
  });
  await assert.rejects(() => manager.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'fake' } }, sink));
  assert.ok(types.includes('sandbox.error'), `got: ${types.join(',')}`);
});

test('create works without a sink (defaults to no-op)', async () => {
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const manager = new SandboxManager({
    providers: [new FakeSandboxProvider()],
    snapshotStore: new LocalSnapshotStore({ root: snapRoot }),
    clock: () => '2026-06-06T00:00:00.000Z',
  });
  const session = await manager.create({ manifest: createManifest({ entries: {}, env: {} }), options: { type: 'fake' } });
  assert.ok(session);
});
