import type { Manifest } from '../manifest.js';
import type { SandboxSession } from '../session.js';
import type { Capability } from './capability.js';

export interface FilesystemCapabilitySpec {
  /** workspace-relative roots the agent may write to. */
  writableRoots: string[];
  /** workspace-relative attached file/dir sets (informational; entries drive actual staging). */
  attached?: string[];
}

export class FilesystemCapability implements Capability {
  readonly type = 'filesystem';
  private session?: SandboxSession;
  constructor(public readonly spec: FilesystemCapabilitySpec) {}
  bind(session: SandboxSession): void { this.session = session; }
  processManifest(manifest: Manifest): Manifest { return manifest; }
  async resolve(): Promise<void> { /* nothing deferred in v1 */ }
  get writableRoots(): string[] { return this.spec.writableRoots; }
}
