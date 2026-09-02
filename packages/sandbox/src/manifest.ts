import { MountConfigError } from './errors.js';

/** Stage a single local file into the workspace. */
export interface LocalFile {
  type: 'local_file';
  src: string;   // absolute host path
  dest: string;  // workspace-relative path
}

/** Stage a local directory tree into the workspace. */
export interface LocalDir {
  type: 'local_dir';
  src: string;   // absolute host path
  dest: string;  // workspace-relative path
}

/**
 * Write literal content into the workspace. Used for orchestrator-generated files
 * (AGENTS.md, context/*.md) that exist only in memory — no host src path to copy from.
 */
export interface InlineFile {
  type: 'inline_file';
  dest: string;     // workspace-relative path
  content: string;  // written verbatim
}

/**
 * Mount entries (git_mount) are declared in mounts/*.ts and registered via
 * registerEntryParser. Entry is the open union below; parseManifest delegates to the registry.
 */
export type Entry = LocalFile | LocalDir | InlineFile | { type: string; [k: string]: unknown };

/**
 * Workspace policy declared on the manifest. The provider uses this to align
 * filesystem ownership/permissions with the runtime identity that will execute
 * inside the sandbox — closing the EACCES gap where host-owned bind copies
 * (uid 501) files copied in via `docker cp` were not writable by the container's
 * `node` user (uid 1000).
 */
export interface WorkspacePolicy {
  /**
   * 'rw' (default): the runtime user must be able to read AND write under
   * `manifest.root`. The docker provider chowns the tree to `runAs` after
   * every materialize/hydrate pass and ensures the user-write bit is set.
   * 'ro': writes must fail. The provider strips write bits from `manifest.root`.
   * Snapshot-only audit sessions can opt into 'ro'.
   */
  writeAccess?: 'rw' | 'ro';
  /**
   * Numeric uid/gid the sandbox should treat as the workspace owner. When
   * unset, the provider resolves it from the container's default user (e.g.
   * `docker exec <c> id`) so the workspace matches the process that runs the
   * agent. Callers should set this explicitly only when they know the runtime
   * identity in advance (avoids one extra `docker exec`).
   *
   * Workers do NOT get to influence this — the host wires it from the worker
   * profile/image, never from manifest content that could originate from
   * untrusted task metadata.
   */
  runAs?: { uid: number; gid: number };
}

export interface Manifest {
  version: 1;
  root: string;
  entries: Record<string, Entry>;
  env: Record<string, string>;
  workspace?: WorkspacePolicy;
}

export interface CreateManifestInput {
  entries: Record<string, Entry>;
  env: Record<string, string>;
  root?: string;
  workspace?: WorkspacePolicy;
}

export function createManifest(input: CreateManifestInput): Manifest {
  return {
    version: 1,
    root: input.root ?? '/workspace',
    entries: input.entries,
    env: input.env,
    ...(input.workspace ? { workspace: input.workspace } : {}),
  };
}

/** Entry parsers registered by mount modules (git, s3). Keyed by `type`. */
const ENTRY_PARSERS: Record<string, (raw: Record<string, unknown>) => Entry> = {
  local_file: (raw) => assertLocalEntry('local_file', raw) as LocalFile,
  local_dir: (raw) => assertLocalEntry('local_dir', raw) as LocalDir,
  inline_file: (raw) => assertInlineFile(raw),
};

function assertInlineFile(raw: Record<string, unknown>): InlineFile {
  if (typeof raw.dest !== 'string') throw new MountConfigError('inline_file requires string dest', { raw });
  if (typeof raw.content !== 'string') throw new MountConfigError('inline_file requires string content', { raw });
  assertWorkspaceRelative(raw.dest);
  return { type: 'inline_file', dest: raw.dest, content: raw.content };
}

/** Mount modules call this at import time to register their entry type. */
export function registerEntryParser(type: string, parser: (raw: Record<string, unknown>) => Entry): void {
  ENTRY_PARSERS[type] = parser;
}

function assertLocalEntry(type: string, raw: Record<string, unknown>): Entry {
  const src = raw.src;
  const dest = raw.dest;
  if (typeof src !== 'string' || typeof dest !== 'string') {
    throw new MountConfigError(`${type} requires string src and dest`, { raw });
  }
  assertWorkspaceRelative(dest);
  return { type, src, dest } as Entry;
}

export function assertWorkspaceRelative(dest: string): void {
  if (dest.startsWith('/') || dest.includes('..')) {
    throw new MountConfigError('dest must be workspace-relative (no leading / or ..)', { dest });
  }
}

function parseWorkspacePolicy(raw: unknown): WorkspacePolicy | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new MountConfigError('manifest.workspace must be an object', { raw });
  const obj = raw as Record<string, unknown>;
  const policy: WorkspacePolicy = {};
  if (obj.writeAccess !== undefined) {
    if (obj.writeAccess !== 'rw' && obj.writeAccess !== 'ro') {
      throw new MountConfigError(`manifest.workspace.writeAccess must be 'rw' or 'ro'`, { value: obj.writeAccess });
    }
    policy.writeAccess = obj.writeAccess;
  }
  if (obj.runAs !== undefined) {
    if (!obj.runAs || typeof obj.runAs !== 'object') {
      throw new MountConfigError('manifest.workspace.runAs must be an object', { raw: obj.runAs });
    }
    const runAs = obj.runAs as Record<string, unknown>;
    const uid = runAs.uid;
    const gid = runAs.gid;
    if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 0) {
      throw new MountConfigError('manifest.workspace.runAs.uid must be a non-negative integer', { uid });
    }
    if (typeof gid !== 'number' || !Number.isInteger(gid) || gid < 0) {
      throw new MountConfigError('manifest.workspace.runAs.gid must be a non-negative integer', { gid });
    }
    policy.runAs = { uid, gid };
  }
  return policy;
}

export function parseManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== 'object') throw new MountConfigError('manifest must be an object', {});
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) throw new MountConfigError('manifest version must be 1', { version: obj.version });
  const root = typeof obj.root === 'string' ? obj.root : '/workspace';
  const env = (obj.env && typeof obj.env === 'object') ? (obj.env as Record<string, string>) : {};
  const rawEntries = (obj.entries && typeof obj.entries === 'object') ? obj.entries as Record<string, unknown> : {};
  const entries: Record<string, Entry> = {};
  for (const [key, value] of Object.entries(rawEntries)) {
    if (!value || typeof value !== 'object') throw new MountConfigError('entry must be an object', { key });
    const entryObj = value as Record<string, unknown>;
    const type = entryObj.type;
    if (typeof type !== 'string') throw new MountConfigError('entry missing type', { key });
    const parser = ENTRY_PARSERS[type];
    if (!parser) throw new MountConfigError(`unknown entry type \`${type}\``, { key, type });
    entries[key] = parser(entryObj);
  }
  const workspace = parseWorkspacePolicy(obj.workspace);
  return { version: 1, root, entries, env, ...(workspace ? { workspace } : {}) };
}
