/** Base class for all sandbox errors. Carries a machine-readable code. */
export class SandboxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A mount could not be configured or activated. */
export class MountConfigError extends SandboxError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('mount_config', message, context);
  }
}

/** A snapshot could not be persisted or restored. */
export class SnapshotError extends SandboxError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('snapshot', message, context);
  }
}

/** A capability or backend feature is not yet implemented. */
export class NotImplementedError extends SandboxError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('not_implemented', message, context);
  }
}
