import { performance } from 'node:perf_hooks';
import { SandboxError } from './errors.js';
import { NullSandboxEventSink, type SandboxContainerInfo, type SandboxEventPayload, type SandboxEventSink, type SandboxPhase } from './events.js';
import type { Manifest } from './manifest.js';
import { mountForEntry, type Mount } from './mounts/mount.js';
import type { ProviderOptions, SandboxProvider } from './provider.js';
import type { SandboxSession, SandboxSessionState } from './session.js';
import type { SnapshotRef, SnapshotStore } from './snapshot/snapshot.js';
import type { JsonValue } from './types.js';

export interface SandboxManagerOptions {
  providers: SandboxProvider[];
  snapshotStore: SnapshotStore;
  /** Returns an ISO timestamp. Injected for deterministic tests. */
  clock: () => string;
  /** Optional: extra mount factories that need injected deps (e.g. S3 client). */
  mountFactories?: Record<string, (entry: Record<string, unknown>) => Mount>;
}

export interface SnapshotExtras {
  sidecars?: Record<string, JsonValue>;
  files?: Record<string, string>;
}

export class SandboxManager {
  private readonly providers = new Map<string, SandboxProvider>();
  readonly snapshotStore: SnapshotStore;
  private readonly clock: () => string;
  private readonly mountFactories: Record<string, (entry: Record<string, unknown>) => Mount>;
  /** Tracks active mounts per session so snapshot() can call capture(). */
  private readonly activeMounts = new WeakMap<SandboxSession, Mount[]>();

  constructor(opts: SandboxManagerOptions) {
    for (const p of opts.providers) this.providers.set(p.backendId, p);
    this.snapshotStore = opts.snapshotStore;
    this.clock = opts.clock;
    this.mountFactories = opts.mountFactories ?? {};
  }

  private providerFor(type: string): SandboxProvider {
    const p = this.providers.get(type);
    if (!p) throw new SandboxError('provider', `no provider registered for type \`${type}\``, { type });
    return p;
  }

  /** Project session state + phase into the typed SandboxEventPayload (DEC8). */
  private payload(
    session: SandboxSession | undefined,
    phase: SandboxPhase,
    backend: string,
    extra?: Partial<SandboxEventPayload>,
  ): SandboxEventPayload {
    const container = session?.state.container as SandboxContainerInfo | undefined;
    return {
      sessionId: session?.state.sessionId ?? '',
      phase,
      backend,
      at: this.clock(),
      ...(container ? { container } : {}),
      ...extra,
    };
  }

  async create(input: { manifest: Manifest; options: ProviderOptions; snapshot?: SnapshotRef }, sink: SandboxEventSink = new NullSandboxEventSink()): Promise<SandboxSession> {
    const backend = input.options.type;
    const provider = this.providerFor(backend);
    const t0 = performance.now();
    let session: SandboxSession | undefined;
    try {
      await sink.emit('sandbox.container.creating', this.payload(undefined, 'creating', backend));
      session = await provider.create(input);
      await sink.emit('sandbox.container.created', this.payload(session, 'created', backend));
      await sink.emit('sandbox.manifest.materializing', this.payload(session, 'materializing', backend, { detail: { entries: Object.keys(input.manifest.entries).length } }));
      await session.start();
      // Activate mounts (entries whose type has a Mount factory).
      const mounts: Mount[] = [];
      for (const entry of Object.values(input.manifest.entries) as Record<string, unknown>[]) {
        const custom = this.mountFactories[entry.type as string];
        const mount = custom ? custom(entry) : mountForEntry(entry);
        if (mount) {
          await mount.activate(session);
          mounts.push(mount);
        }
      }
      this.activeMounts.set(session, mounts);
      await sink.emit('sandbox.manifest.materialized', this.payload(session, 'materialized', backend));
      await sink.emit('sandbox.container.started', this.payload(session, 'started', backend, { durationMs: Math.round(performance.now() - t0) }));
      return session;
    } catch (err) {
      await sink.emit('sandbox.error', this.payload(session, 'error', backend, { error: { message: err instanceof Error ? err.message : String(err) } }));
      throw err;
    }
  }

  async resume(state: SandboxSessionState): Promise<SandboxSession> {
    return this.providerFor(state.type).resume(state);
  }

  async destroy(session: SandboxSession, sink: SandboxEventSink = new NullSandboxEventSink()): Promise<void> {
    const backend = session.state.type;
    const t0 = performance.now();
    try {
      await sink.emit('sandbox.container.stopping', this.payload(session, 'stopping', backend));
      await this.providerFor(backend).destroy(session);
      await sink.emit('sandbox.container.destroyed', this.payload(session, 'destroyed', backend, { durationMs: Math.round(performance.now() - t0) }));
    } catch (err) {
      await sink.emit('sandbox.error', this.payload(session, 'error', backend, { error: { message: err instanceof Error ? err.message : String(err) } }));
      throw err;
    }
  }

  async snapshot(session: SandboxSession, extras: SnapshotExtras = {}, sink: SandboxEventSink = new NullSandboxEventSink()): Promise<SnapshotRef> {
    const backend = session.state.type;
    const t0 = performance.now();
    try {
      await sink.emit('sandbox.snapshot.persisting', this.payload(session, 'snapshotting', backend));
      const sidecars: Record<string, JsonValue> = { ...(extras.sidecars ?? {}) };
      const files: Record<string, string> = { ...(extras.files ?? {}) };

      // Capture from each mount (git diff/branch).
      for (const mount of this.activeMounts.get(session) ?? []) {
        if (!mount.capture) continue;
        const meta = await mount.capture(session);
        if (mount.type === 'git_mount') {
          files['git/changes.patch'] = String(meta.changesPatch ?? '');
          sidecars['git/branch.json'] = {
            workingBranch: String(meta.workingBranch ?? ''),
            baseSha: String(meta.baseSha ?? ''),
            commits: (meta.commits as string[]) ?? [],
          };
        }
      }

      const ref = await this.snapshotStore.persist({
        id: session.state.sessionId,
        createdAt: this.clock(),
        providerType: session.state.type,
        workspaceTar: await session.persistWorkspace(),
        sidecars,
        files,
      });
      await sink.emit('sandbox.snapshot.persisted', this.payload(session, 'snapshotted', backend, {
        durationMs: Math.round(performance.now() - t0),
        snapshotRef: { location: ref.location, id: ref.id },
      }));
      return ref;
    } catch (err) {
      await sink.emit('sandbox.error', this.payload(session, 'error', backend, { error: { message: err instanceof Error ? err.message : String(err) } }));
      throw err;
    }
  }

  serializeState(session: SandboxSession): JsonValue {
    return this.providerFor(session.state.type).serializeState(session.state);
  }
}
