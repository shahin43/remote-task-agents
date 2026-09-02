import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createManifest, type Manifest } from '../manifest.js';
import { SandboxError } from '../errors.js';
import type { ExecOpts, ExecResult, JsonValue } from '../types.js';
import { makeSessionState, parseSessionState, type SandboxSession, type SandboxSessionState } from '../session.js';
import { copyFileOwned, copyTreeOwned } from '../copy-tree.js';
import type { ProviderOptions, SandboxProvider } from '../provider.js';
import type { SnapshotRef } from '../snapshot/snapshot.js';

export interface UnixLocalProviderOptions {
  /** Root under which each session gets <sessionId>/workspace. */
  workspacesRoot: string;
  /** Override id generation (tests). */
  idFactory?: () => string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

class UnixLocalSession implements SandboxSession {
  constructor(
    public readonly state: SandboxSessionState,
    private readonly manifest: Manifest,
  ) {}

  async start(): Promise<void> {
    await fs.mkdir(this.state.workspaceRoot, { recursive: true });
    for (const entry of Object.values(this.manifest.entries)) {
      await this.materialize(entry as Record<string, unknown>);
    }
    await this.alignOwnership();
  }

  /**
   * unix-local runs the agent as the SAME OS user that created the workspace
   * directory, so 'rw' is automatic — no uid alignment needed. The only thing
   * to enforce is 'ro', which we apply by stripping write bits from the tree.
   * `runAs` is intentionally ignored: this provider runs in-process and we
   * cannot switch uid mid-process.
   */
  async alignOwnership(): Promise<void> {
    const writeAccess = this.manifest.workspace?.writeAccess ?? 'rw';
    if (writeAccess === 'rw') return;
    await chmodReadOnly(this.state.workspaceRoot);
  }

  private async materialize(entry: Record<string, unknown>): Promise<void> {
    const type = entry.type as string;
    if (type === 'local_file') {
      const dest = path.join(this.state.workspaceRoot, entry.dest as string);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await copyFileOwned(entry.src as string, dest);
    } else if (type === 'local_dir') {
      const dest = path.join(this.state.workspaceRoot, entry.dest as string);
      await fs.mkdir(dest, { recursive: true });
      await copyTreeOwned(entry.src as string, dest);
    } else if (type === 'inline_file') {
      const dest = path.join(this.state.workspaceRoot, entry.dest as string);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, entry.content as string);
    }
    // git_mount activation is delegated via the mount registry (the manager
    // calls mount.activate for those entry types — see SandboxManager).
  }

  async exec(cmd: string | string[], opts: ExecOpts = {}): Promise<ExecResult> {
    const cwd = opts.cwd ? path.join(this.state.workspaceRoot, opts.cwd) : this.state.workspaceRoot;
    const useShell = opts.shell !== false;
    const env = { ...process.env, ...this.manifest.env, ...(opts.env ?? {}) };
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return await new Promise<ExecResult>((resolve, reject) => {
      const child = useShell
        ? spawn(typeof cmd === 'string' ? cmd : cmd.join(' '), { cwd, env, shell: true })
        : spawn(Array.isArray(cmd) ? cmd[0] : cmd, Array.isArray(cmd) ? cmd.slice(1) : [], { cwd, env });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new SandboxError('exec_timeout', `command timed out after ${timeoutMs}ms`, { cmd }));
      }, timeoutMs);
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.stdout?.on('error', () => undefined);
      child.stderr?.on('error', () => undefined);
      child.stdin?.on('error', () => undefined);
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr }); });
    });
  }

  async read(p: string): Promise<Readable> {
    return createReadStream(path.join(this.state.workspaceRoot, p));
  }

  async write(p: string, data: Readable | Buffer | string): Promise<void> {
    const dest = path.join(this.state.workspaceRoot, p);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (typeof data === 'string' || Buffer.isBuffer(data)) {
      await fs.writeFile(dest, data);
    } else {
      const { createWriteStream } = await import('node:fs');
      await new Promise<void>((resolve, reject) => {
        const w = createWriteStream(dest);
        data.pipe(w);
        w.on('finish', () => resolve());
        w.on('error', reject);
      });
    }
  }

  async persistWorkspace(): Promise<Readable> {
    // tar the workspace root with paths relative to it (-C root .)
    const child = spawn(
      'tar',
      [
        '-cf',
        '-',
        '-C',
        this.state.workspaceRoot,
        '--exclude',
        '._*',
        '--exclude',
        '.DS_Store',
        '--exclude',
        '__MACOSX',
        '--exclude',
        'artifacts/workspace.tar',
        '.',
      ],
      { env: { ...process.env, COPYFILE_DISABLE: '1' } },
    );
    child.on('error', () => { /* surfaced by the consuming stream */ });
    if (child.stdout) child.stdout.on('error', () => undefined);
    return child.stdout;
  }

  async stop(): Promise<void> {
    // No long-lived process to stop in the unix-local backend.
  }
}

/** Recursively strip write bits from a tree (used for manifest writeAccess: 'ro'). */
async function chmodReadOnly(root: string): Promise<void> {
  const stat = await fs.stat(root);
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(root)) {
      await chmodReadOnly(path.join(root, entry));
    }
  }
  // Preserve read + exec (for traversal); drop all write bits.
  await fs.chmod(root, stat.mode & 0o555);
}

/** Inverse of chmodReadOnly — restore user-write so the cleanup `fs.rm` works. */
async function restoreWritable(root: string): Promise<void> {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) return;
  await fs.chmod(root, stat.mode | 0o700);
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(root)) {
      await restoreWritable(path.join(root, entry));
    }
  }
}

export class UnixLocalSandboxProvider implements SandboxProvider {
  readonly backendId = 'unix_local';
  private readonly opts: UnixLocalProviderOptions;

  constructor(opts: UnixLocalProviderOptions) {
    this.opts = opts;
  }

  async create(input: { manifest: Manifest; snapshot?: SnapshotRef; options: ProviderOptions }): Promise<SandboxSession> {
    const sessionId = (this.opts.idFactory ?? randomUUID)();
    const workspaceRoot = path.join(this.opts.workspacesRoot, sessionId, 'workspace');
    const root = input.manifest.root ?? '/workspace';
    const state = makeSessionState('unix_local', sessionId, workspaceRoot, {
      manifestRoot: root,
      workspaceRootOwned: true,
    });
    return new UnixLocalSession(state, input.manifest);
  }

  async resume(state: SandboxSessionState): Promise<SandboxSession> {
    // Reattach to an existing workspace dir; manifest is empty because the FS already exists.
    return new UnixLocalSession(state, createManifest({ entries: {}, env: {} }));
  }

  async destroy(session: SandboxSession): Promise<void> {
    const owned = session.state.workspaceRootOwned !== false;
    if (owned) {
      // Remove the per-session parent dir (<workspacesRoot>/<sessionId>).
      // A manifest with writeAccess: 'ro' may have stripped write bits across
      // the tree; restore them before fs.rm so cleanup can't fail with EACCES.
      const sessionDir = path.dirname(session.state.workspaceRoot);
      await restoreWritable(sessionDir).catch(() => undefined);
      await fs.rm(sessionDir, { recursive: true, force: true });
    }
    await session.stop();
  }

  serializeState(state: SandboxSessionState): JsonValue {
    return JSON.parse(JSON.stringify(state)) as JsonValue;
  }

  deserializeState(payload: JsonValue): SandboxSessionState {
    return parseSessionState(payload);
  }
}
