import type { Manifest } from '../manifest.js';
import type { SandboxSession } from '../session.js';

/**
 * A capability configures the workspace/policy. Unlike OpenAI's Capability it does NOT
 * expose tools()/sampling — the agent loop (engine) is external to this compute plane.
 */
export interface Capability {
  readonly type: string;
  bind(session: SandboxSession): void;
  /** Transform the manifest before materialization (e.g. add writable-root markers). */
  processManifest(manifest: Manifest): Manifest;
  /** Resolve any deferred config (credentials, probes) after bind. */
  resolve(): Promise<void>;
}
