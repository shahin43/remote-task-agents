/** A value that round-trips through JSON.parse(JSON.stringify(x)). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Result of running a command inside a sandbox session. */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Convenience: did the command succeed (exit 0)? */
export function execOk(r: ExecResult): boolean {
  return r.exitCode === 0;
}

/**
 * A reference to a credential resolved at materialization time.
 * The raw secret is NEVER stored here — only an id the resolver understands.
 */
export interface CredentialRef {
  /** Opaque id the CredentialResolver maps to a real secret. */
  id: string;
}

/** Options passed to exec(). */
export interface ExecOpts {
  /** Working directory relative to the session workspace root. Default: root. */
  cwd?: string;
  /** Extra environment variables for this command. */
  env?: Record<string, string>;
  /** Timeout in milliseconds. Default: 120_000. */
  timeoutMs?: number;
  /** If false, run the command without a shell (argv form). Default: true. */
  shell?: boolean;
}
