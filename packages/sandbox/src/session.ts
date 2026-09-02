import type { Readable } from 'node:stream';
import { SandboxError } from './errors.js';
import type { ExecOpts, ExecResult } from './types.js';

/**
 * Serializable identity of a session. Backends extend it with extra fields
 * (kept as a flat record so it round-trips through JSON unchanged).
 */
export interface SandboxSessionState {
  type: string;          // backend id, e.g. 'unix_local'
  sessionId: string;
  workspaceRoot: string; // absolute host path to the materialized workspace root
  [key: string]: unknown;
}

export function makeSessionState(
  type: string,
  sessionId: string,
  workspaceRoot: string,
  extra: Record<string, unknown>,
): SandboxSessionState {
  return { type, sessionId, workspaceRoot, ...extra };
}

export function parseSessionState(raw: unknown): SandboxSessionState {
  if (!raw || typeof raw !== 'object') throw new SandboxError('state', 'session state must be an object');
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string') throw new SandboxError('state', 'session state missing type');
  if (typeof obj.sessionId !== 'string') throw new SandboxError('state', 'session state missing sessionId');
  if (typeof obj.workspaceRoot !== 'string') throw new SandboxError('state', 'session state missing workspaceRoot');
  return obj as SandboxSessionState;
}

/** A long-lived process with attached stdio, launched inside the sandbox. */
export interface StreamHandle {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  /** Send a signal to the process. */
  kill(signal?: NodeJS.Signals): void;
  /** Resolves with the process exit code (or null if killed by signal). */
  readonly exitCode: Promise<number | null>;
}

/** A live sandbox session. The unit engine runs inside (via cwd = workspaceRoot). */
export interface SandboxSession {
  readonly state: SandboxSessionState;
  /** Materialize manifest entries + mounts + capabilities. Idempotent. */
  start(): Promise<void>;
  /** Run a command. Paths are relative to the workspace root unless absolute. */
  exec(cmd: string | string[], opts?: ExecOpts): Promise<ExecResult>;
  /** Read a workspace-relative file as a stream. */
  read(path: string): Promise<Readable>;
  /** Write a workspace-relative file. */
  write(path: string, data: Readable | Buffer | string): Promise<void>;
  /** Produce a tar stream of the entire workspace root. */
  persistWorkspace(): Promise<Readable>;
  /** Stop the session and release transient resources (does NOT delete the workspace). */
  stop(): Promise<void>;
  /**
   * Spawn a long-lived process with attached stdio inside the sandbox (e.g. a persistent
   * JSON-RPC server). Optional: backends that cannot host a persistent process omit it.
   */
  spawnStream?(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): StreamHandle;
  /**
   * Re-apply the manifest's `workspace` policy (ownership + write bits) over
   * `manifest.root`. Called automatically after `start()`; callers MUST invoke
   * it explicitly after any out-of-band write into the workspace (e.g.
   * snapshot hydrate, which uses `docker cp` rather than `session.write`).
   * Idempotent. No-op when the backend has no ownership concept (unix-local
   * `'rw'`) or no manifest policy is set.
   */
  alignOwnership?(): Promise<void>;
  /**
   * Run the agent inside an isolated remote guest (remote guest). Host
   * materialize + mounts finish first; this packs the seed, launches, waits.
   */
  runIsolatedAgent?(): Promise<void>;
}
