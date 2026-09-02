import { Readable } from 'node:stream';
import { createManifest, type Manifest } from '../manifest.js';
import type { ProviderOptions, SandboxProvider } from '../provider.js';
import { makeSessionState, parseSessionState, type SandboxSession, type SandboxSessionState } from '../session.js';
import type { SnapshotRef } from '../snapshot/snapshot.js';
import type { ExecOpts, ExecResult, JsonValue } from '../types.js';
import { GUEST_IMAGE_CONTRACT, GUEST_IMAGE_ENGINE, GUEST_IMAGE_KIND } from '../guest-image.js';

class FakeSession implements SandboxSession {
  files = new Map<string, string>();
  execLog: Array<string | string[]> = [];
  isolatedRuns = 0;
  runIsolatedAgent?: () => Promise<void>;
  constructor(
    public readonly state: SandboxSessionState,
    private readonly failStart = false,
    isolated = false,
  ) {
    if (isolated) {
      this.runIsolatedAgent = async () => {
        this.isolatedRuns += 1;
        this.files.set('artifacts/summary.md', 'isolated-ok');
      };
    }
  }
  async start(): Promise<void> { if (this.failStart) throw new Error('fake start failure'); }
  async exec(cmd: string | string[], _opts?: ExecOpts): Promise<ExecResult> {
    this.execLog.push(cmd);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async read(path: string): Promise<Readable> { return Readable.from([this.files.get(path) ?? '']); }
  async write(path: string, data: Readable | Buffer | string): Promise<void> {
    this.files.set(path, typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : '');
  }
  async persistWorkspace(): Promise<Readable> { return Readable.from(['FAKE_TAR']); }
  async stop(): Promise<void> {}
}

export class FakeSandboxProvider implements SandboxProvider {
  readonly backendId = 'fake';
  created: FakeSession[] = [];
  destroyed: FakeSession[] = [];
  /** When true, sessions created here throw on start() (to exercise the manager error path). */
  failStart = false;
  /** When true, sessions expose runIsolatedAgent (remote guest-style). */
  isolatedAgent = false;
  private n = 0;

  async create(_input: { manifest: Manifest; snapshot?: SnapshotRef; options: ProviderOptions }): Promise<SandboxSession> {
    const id = `fake-${++this.n}`;
    // Stamp container metadata into state so the manager can project it onto sandbox.* events.
    const state = makeSessionState('fake', id, `/fake/ws-${this.n}`, {
      container: {
        id,
        image: 'fake:latest',
        digest: 'sha256:fake',
        identity: {
          name: 'fake:latest',
          digest: 'sha256:fake',
          engine: GUEST_IMAGE_ENGINE,
          kind: GUEST_IMAGE_KIND,
          bundleSha256: null,
          gitSha: null,
          contract: GUEST_IMAGE_CONTRACT,
        },
        labels: { project: 'remote-sandbox-agents', session_id: id },
        network: true,
      },
    });
    const s = new FakeSession(state, this.failStart, this.isolatedAgent);
    this.created.push(s);
    return s;
  }
  async resume(state: SandboxSessionState): Promise<SandboxSession> { return new FakeSession(state); }
  async destroy(session: SandboxSession): Promise<void> { this.destroyed.push(session as FakeSession); }
  serializeState(state: SandboxSessionState): JsonValue { return JSON.parse(JSON.stringify(state)) as JsonValue; }
  deserializeState(payload: JsonValue): SandboxSessionState { return parseSessionState(payload); }
}

/** Re-export so consumers can build manifests in tests without importing the barrel. */
export { createManifest };
