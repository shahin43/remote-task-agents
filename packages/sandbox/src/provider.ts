import type { JsonValue } from './types.js';
import type { Manifest } from './manifest.js';
import type { SandboxSession, SandboxSessionState } from './session.js';
import type { SnapshotRef } from './snapshot/snapshot.js';

/** Backend-specific creation options. Type-tagged + serializable. */
export interface ProviderOptions {
  type: string;            // matches a provider backendId
  [key: string]: unknown;
}

/** A pluggable compute backend (unix-local, docker, hosted, ...). */
export interface SandboxProvider {
  readonly backendId: string;
  create(input: { manifest: Manifest; snapshot?: SnapshotRef; options: ProviderOptions }): Promise<SandboxSession>;
  resume(state: SandboxSessionState): Promise<SandboxSession>;
  destroy(session: SandboxSession): Promise<void>;
  serializeState(state: SandboxSessionState): JsonValue;
  deserializeState(payload: JsonValue): SandboxSessionState;
}
