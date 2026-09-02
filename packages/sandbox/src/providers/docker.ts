import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createManifest, type Manifest } from '../manifest.js';
import { SandboxError } from '../errors.js';
import type { ExecOpts, ExecResult, JsonValue } from '../types.js';
import { makeSessionState, parseSessionState, type SandboxSession, type SandboxSessionState, type StreamHandle } from '../session.js';
import type { ProviderOptions, SandboxProvider } from '../provider.js';
import type { SnapshotRef } from '../snapshot/snapshot.js';
import { buildCreateArgs, buildExecArgs, buildExecStreamArgs, runDocker, type DockerCreateSpec } from './docker-cli.js';
import { identityFromInspect } from '../guest-image.js';

export interface DockerProviderOptions {
  /** Path to the docker CLI (default 'docker'; '/opt/homebrew/bin/docker' on this machine). */
  dockerBin?: string;
  /** Image to run the worker in. */
  image: string;
  /** Hardening defaults (overridable per ProviderOptions later). */
  cpus?: string;
  memoryMb?: number;
  pids?: number;
  /** Allow network (engine needs OpenAI). Default true. */
  network?: boolean;
  /** Env var names allowed to forward into the container (values read from manifest.env). */
  envAllowlist?: string[];
  idFactory?: () => string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

class DockerSandboxSession implements SandboxSession {
  constructor(
    public readonly state: SandboxSessionState,
    private readonly manifest: Manifest,
    private readonly dockerBin: string,
  ) {}

  private get container(): string { return String(this.state.containerId); }
  private get root(): string { return String(this.state.manifestRoot ?? '/workspace'); }

  async start(): Promise<void> {
    // Ensure the workspace root exists FIRST, with NO `-w` workdir — `docker exec -w <dir>`
    // requires the directory to already exist, so the bootstrap mkdir must run without it.
    const mk = await runDocker(this.dockerBin, buildExecArgs(this.container, ['mkdir', '-p', this.root]));
    if (mk.exitCode !== 0) throw new SandboxError('start', `mkdir workspace root failed: ${mk.stderr}`, { root: this.root });
    // Now the root exists, so subsequent exec calls (which default `-w` to the root) succeed.
    for (const entry of Object.values(this.manifest.entries)) {
      await this.materialize(entry as Record<string, unknown>);
    }
    // Apply the manifest's workspace policy over everything we just materialized.
    // This fixes the EACCES class of failures where `docker cp` preserves host
    // uid/gid (typically uid 501 on macOS) but the agent runs as the image's
    // default user (e.g. uid 1000 `node`). Without this, every `write_file` /
    // `mkdir` from the agent fails with `Permission denied`.
    await this.alignOwnership();
  }

  /**
   * Resolve the runtime identity that should own the workspace tree. Order:
   *  1) manifest.workspace.runAs (caller already knows)
   *  2) cached value from a prior alignOwnership() call
   *  3) one-shot `docker exec <c> id` parse (runs as the image's default user)
   * Errors are non-fatal — alignOwnership() will skip the chown rather than
   * fail the session, and the caller will see EACCES at first write (the
   * existing behavior, not a regression).
   */
  private async resolveRunAs(): Promise<{ uid: number; gid: number } | null> {
    const declared = this.manifest.workspace?.runAs;
    if (declared) return declared;
    if (this.cachedRunAs) return this.cachedRunAs;
    // `id -u; id -g` runs as the container's default user (no `-u 0` flag).
    const res = await runDocker(
      this.dockerBin,
      buildExecArgs(this.container, ['sh', '-lc', 'printf "%s:%s" "$(id -u)" "$(id -g)"']),
    );
    if (res.exitCode !== 0) return null;
    const match = res.stdout.trim().match(/^(\d+):(\d+)$/);
    if (!match) return null;
    const uid = Number(match[1]);
    const gid = Number(match[2]);
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) return null;
    this.cachedRunAs = { uid, gid };
    return this.cachedRunAs;
  }
  private cachedRunAs: { uid: number; gid: number } | null = null;

  async alignOwnership(): Promise<void> {
    const policy = this.manifest.workspace ?? {};
    const writeAccess: 'rw' | 'ro' = policy.writeAccess ?? 'rw';
    const runAs = await this.resolveRunAs();
    if (!runAs) return; // best-effort; agent will surface EACCES if relevant
    // Run as namespaced root (`-u 0:0`) so we can chown files that were copied
    // in via `docker cp` and currently belong to the host user. The container
    // is still `--cap-drop ALL --security-opt no-new-privileges`, so namespaced
    // root has no special privileges on the host.
    const chown = await runDocker(
      this.dockerBin,
      ['exec', '-u', '0:0', this.container, 'chown', '-R', `${runAs.uid}:${runAs.gid}`, this.root],
    );
    if (chown.exitCode !== 0) {
      throw new SandboxError(
        'align_ownership',
        `chown ${runAs.uid}:${runAs.gid} ${this.root} failed: ${chown.stderr.trim()}`,
        { root: this.root, runAs },
      );
    }
    // chmod step: 'rw' guarantees the user-write bit (X = dirs/exec-only); 'ro'
    // strips all write bits so any later `write_file` fails fast inside the
    // container instead of silently appearing to succeed.
    const modeArgs = writeAccess === 'rw'
      ? ['u+rwX,g+rX,o-rwx']
      : ['a-w'];
    const chmod = await runDocker(
      this.dockerBin,
      ['exec', '-u', '0:0', this.container, 'chmod', '-R', ...modeArgs, this.root],
    );
    if (chmod.exitCode !== 0) {
      throw new SandboxError(
        'align_ownership',
        `chmod ${modeArgs.join(' ')} ${this.root} failed: ${chmod.stderr.trim()}`,
        { root: this.root, writeAccess },
      );
    }
  }

  private destOf(rel: string): string {
    return rel.startsWith('/') ? rel : path.posix.join(this.root, rel);
  }

  private async materialize(entry: Record<string, unknown>): Promise<void> {
    const type = entry.type as string;
    if (type === 'inline_file') {
      const dest = this.destOf(entry.dest as string);
      await this.exec(['mkdir', '-p', path.posix.dirname(dest)], { shell: false });
      // Stream the content via `docker exec -i sh -lc 'cat > "$1"' sh <dest>`.
      const args = buildExecStreamArgs(this.container, 'sh', ['-lc', 'cat > "$1"', 'sh', dest], {});
      const res = await runDocker(this.dockerBin, args, { input: entry.content as string });
      if (res.exitCode !== 0) throw new SandboxError('materialize', `inline_file failed: ${res.stderr}`, { dest });
    } else if (type === 'local_file' || type === 'local_dir') {
      // Copy host path into the container with `docker cp`.
      const dest = this.destOf(entry.dest as string);
      await this.exec(['mkdir', '-p', path.posix.dirname(dest)], { shell: false });
      const res = await runDocker(this.dockerBin, ['cp', String(entry.src), `${this.container}:${dest}`]);
      if (res.exitCode !== 0) throw new SandboxError('materialize', `${type} cp failed: ${res.stderr}`, { dest });
    }
    // git_mount entries are activated by the SandboxManager via mount.activate(session),
    // which calls session.exec(['git','clone',...]) — works in-container unchanged.
  }

  async exec(cmd: string | string[], opts: ExecOpts = {}): Promise<ExecResult> {
    const cmdArr = Array.isArray(cmd) ? cmd : ['sh', '-lc', cmd];
    const cwd = opts.cwd ? this.destOf(opts.cwd) : this.root;
    const args = buildExecArgs(this.container, cmdArr, { cwd });
    // env per-exec: prepend `--env` flags (insert after 'exec').
    if (opts.env) {
      const envFlags: string[] = [];
      for (const [k, v] of Object.entries(opts.env)) envFlags.push('--env', `${k}=${v}`);
      args.splice(1, 0, ...envFlags);
    }
    return runDocker(this.dockerBin, args, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  }

  spawnStream(cmd: string, cmdArgs: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): StreamHandle {
    const cwd = opts.cwd ? this.destOf(opts.cwd) : this.root;
    const args = buildExecStreamArgs(this.container, cmd, cmdArgs, { cwd, env: opts.env });
    const child = spawn(this.dockerBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const exitCode = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
      child.on('error', () => resolve(null));
    });
    // Stream-level error guards: when the container is destroyed mid-write
    // (or the guest process exits before we drain stdout), Node emits an 'error' event
    // (typically EPIPE / ECONNRESET) on the stdio streams. Without a listener
    // those bubble up to `process.uncaughtException` and crash the entire
    // scheduler. Swallow them — the consumer already observes failure via
    // `exitCode` resolving to a non-zero/null code.
    if (child.stdin) child.stdin.on('error', () => undefined);
    if (child.stdout) child.stdout.on('error', () => undefined);
    if (child.stderr) child.stderr.on('error', () => undefined);
    child.on('error', () => undefined);
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      kill: (signal?: NodeJS.Signals) => { child.kill(signal); },
      exitCode,
    };
  }

  async read(p: string): Promise<Readable> {
    const res = await this.exec(['cat', this.destOf(p)], { shell: false });
    if (res.exitCode !== 0) throw new SandboxError('read', `cat failed: ${res.stderr}`, { path: p });
    return Readable.from([res.stdout]);
  }

  async write(p: string, data: Readable | Buffer | string): Promise<void> {
    const dest = this.destOf(p);
    await this.exec(['mkdir', '-p', path.posix.dirname(dest)], { shell: false });
    const content = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : await streamToString(data);
    const args = buildExecStreamArgs(this.container, 'sh', ['-lc', 'cat > "$1"', 'sh', dest], {});
    const res = await runDocker(this.dockerBin, args, { input: content });
    if (res.exitCode !== 0) throw new SandboxError('write', `write failed: ${res.stderr}`, { path: p });
  }

  async persistWorkspace(): Promise<Readable> {
    // tar the workspace root from inside the container, stream stdout to the host.
    const args = buildExecArgs(this.container, ['tar', '-cf', '-', '-C', this.root, '.']);
    const child = spawn(this.dockerBin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    // Same EPIPE guard as spawnStream — consumer sees the stream end early
    // rather than crashing the process when the container goes away.
    child.on('error', () => undefined);
    if (child.stdout) child.stdout.on('error', () => undefined);
    return child.stdout;
  }

  async stop(): Promise<void> {
    await runDocker(this.dockerBin, ['stop', this.container]).catch(() => undefined);
  }
}

async function streamToString(r: Readable): Promise<string> {
  let s = '';
  for await (const chunk of r) s += chunk.toString();
  return s;
}

export function dockerCreateLabels(sessionId: string, options: ProviderOptions): Record<string, string> {
  const extra = options.labels;
  const out: Record<string, string> = { project: 'remote-sandbox-agents', session_id: sessionId };
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) out[key] = value;
    }
  }
  return out;
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly backendId = 'docker';
  private readonly opts: DockerProviderOptions;
  private readonly dockerBin: string;

  constructor(opts: DockerProviderOptions) {
    this.opts = opts;
    this.dockerBin = opts.dockerBin ?? 'docker';
  }

  async create(input: { manifest: Manifest; snapshot?: SnapshotRef; options: ProviderOptions }): Promise<SandboxSession> {
    const sessionId = (this.opts.idFactory ?? randomUUID)();
    const name = `sbx_${sessionId.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24)}`;
    const root = input.manifest.root ?? '/workspace';

    // Forward only allowlisted env names whose values exist in manifest.env.
    const envAllowlist: Record<string, string> = {};
    for (const name2 of this.opts.envAllowlist ?? []) {
      const v = (input.manifest.env as Record<string, string> | undefined)?.[name2];
      if (v !== undefined) envAllowlist[name2] = v;
    }

    const createSpec: DockerCreateSpec = {
      image: this.opts.image,
      name,
      labels: dockerCreateLabels(sessionId, input.options),
      envAllowlist,
      roMounts: collectRoMounts(input.manifest),
      cpus: this.opts.cpus,
      memoryMb: this.opts.memoryMb,
      pids: this.opts.pids,
      tmpfs: ['/tmp'],
      network: this.opts.network ?? true,
    };
    const created = await runDocker(this.dockerBin, buildCreateArgs(createSpec));
    if (created.exitCode !== 0) throw new SandboxError('provider', `docker create failed: ${created.stderr}`, { name });
    const containerId = created.stdout.trim();
    const started = await runDocker(this.dockerBin, ['start', containerId]);
    if (started.exitCode !== 0) throw new SandboxError('provider', `docker start failed: ${started.stderr}`, { containerId });

    const inspected = await runDocker(this.dockerBin, ['inspect', containerId]);
    const identity = identityFromInspect(
      this.opts.image,
      inspected.exitCode === 0 ? inspected.stdout : '',
    );

    // Stamp container metadata into state so the manager can project it onto sandbox.* events
    // (DEC8 / Hermes contract: "emit container id/image/resource metadata to session events").
    const state = makeSessionState('docker', sessionId, root, {
      containerId,
      manifestRoot: root,
      container: {
        id: containerId,
        image: this.opts.image,
        digest: identity.digest ?? undefined,
        identity,
        labels: createSpec.labels,
        resources: { cpus: this.opts.cpus, memoryMb: this.opts.memoryMb, pids: this.opts.pids },
        network: createSpec.network,
      },
    });
    return new DockerSandboxSession(state, input.manifest, this.dockerBin);
  }

  async resume(state: SandboxSessionState): Promise<SandboxSession> {
    return new DockerSandboxSession(state, createManifest({ entries: {}, env: {} }), this.dockerBin);
  }

  async destroy(session: SandboxSession): Promise<void> {
    const id = String(session.state.containerId);
    await session.stop();
    await runDocker(this.dockerBin, ['rm', '-f', id]).catch(() => undefined);
  }

  serializeState(state: SandboxSessionState): JsonValue { return JSON.parse(JSON.stringify(state)) as JsonValue; }
  deserializeState(payload: JsonValue): SandboxSessionState { return parseSessionState(payload); }
}

/** Read-only bind mounts derived from the manifest (legacy in-container git clone path). */
function collectRoMounts(manifest: Manifest): Array<{ source: string; target: string }> {
  const out: Array<{ source: string; target: string }> = [];
  for (const entry of Object.values(manifest.entries) as Array<Record<string, unknown>>) {
    if (
      entry.type === 'git_mount'
      && !entry.captureOnly
      && entry.provider === 'local'
      && typeof entry.repo === 'string'
      && entry.repo.startsWith('/')
    ) {
      out.push({ source: entry.repo, target: entry.repo });
    }
  }
  return out;
}
