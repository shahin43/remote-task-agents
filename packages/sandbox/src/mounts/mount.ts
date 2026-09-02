import type { SandboxSession } from '../session.js';

/** A mount activates content into a session's workspace and (optionally) syncs back. */
export interface Mount {
  readonly type: string;
  /** workspace-relative destination directory for the mount. */
  readonly dest: string;
  /** Materialize the mount into the session workspace. */
  activate(session: SandboxSession): Promise<void>;
  /** Optional: capture/sync changes back at snapshot time (S3 upload, git diff). */
  capture?(session: SandboxSession): Promise<Record<string, unknown>>;
}

/** Registry mapping a manifest entry `type` to a Mount factory. */
const MOUNT_FACTORIES: Record<string, (entry: Record<string, unknown>) => Mount> = {};

export function registerMount(type: string, factory: (entry: Record<string, unknown>) => Mount): void {
  MOUNT_FACTORIES[type] = factory;
}

export function mountForEntry(entry: Record<string, unknown>): Mount | null {
  const factory = MOUNT_FACTORIES[entry.type as string];
  return factory ? factory(entry) : null;
}
