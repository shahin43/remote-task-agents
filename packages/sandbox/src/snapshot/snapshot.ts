import type { JsonValue } from '../types.js';

/** A pointer to a persisted snapshot. Serializable. */
export interface SnapshotRef {
  type: string;          // store type, e.g. 'local'
  id: string;            // sessionId-based id
  location: string;      // path or uri
}

/** Canonical `workspace.tar` pointer for restore / remote guest seed. */
export function workspaceTarUri(ref: Pick<SnapshotRef, 'type' | 'location'>): string | null {
  const loc = typeof ref.location === 'string' ? ref.location.replace(/\/+$/, '') : '';
  if (!loc) return null;
  return `${loc}/workspace.tar`;
}

/** The index manifest written alongside a snapshot's artifacts. */
export interface SnapshotIndex {
  schemaVersion: 1;
  id: string;
  createdAt: string;     // ISO; supplied by caller (never Date.now() inside the store for testability)
  providerType: string;
  artifacts: Record<string, { checksum: string; bytes: number }>;
  restorable: boolean;
}

/** What a session hands to the store to be snapshotted. */
export interface SnapshotInput {
  id: string;
  createdAt: string;
  providerType: string;
  /** tar stream of the workspace. */
  workspaceTar: NodeJS.ReadableStream;
  /** Arbitrary JSON sidecars: session.json, git/branch.json, skills.json, etc. */
  sidecars: Record<string, JsonValue>;
  /** Raw text/byte sidecars: transcript.jsonl, logs/events.jsonl, git/changes.patch. */
  files: Record<string, string>;
}

/** One file entry in a snapshot (workspace tar member or sidecar artifact). */
export interface SnapshotFileEntry {
  path: string;
  bytes?: number;
  source: 'workspace' | 'sidecar';
}

/** Result of reading a single file from a snapshot. */
export interface SnapshotFileContent {
  path: string;
  /** UTF-8 decode of `body` (lossy for binary). */
  content: string;
  body: Buffer;
  truncated: boolean;
}

export interface SnapshotStore {
  readonly storeType: string;
  persist(input: SnapshotInput): Promise<SnapshotRef>;
  restorable(ref: SnapshotRef): Promise<boolean>;
  /** Restore the workspace tar into destRoot; returns the parsed index. */
  restore(ref: SnapshotRef, destRoot: string): Promise<SnapshotIndex>;
  readIndex(ref: SnapshotRef): Promise<SnapshotIndex>;
  /** List workspace tar members and sidecar artifacts. */
  listFiles(ref: SnapshotRef): Promise<SnapshotFileEntry[]>;
  /** Read a single file (sidecar or workspace tar member). */
  readFile(ref: SnapshotRef, filePath: string, maxBytes?: number): Promise<SnapshotFileContent>;
}
