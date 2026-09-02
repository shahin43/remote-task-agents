import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveGitCredential, safeGitError, gitCloneUrl, gitAskPassEnv } from './git-credentials.js';

const exec = promisify(execFile);

export type MirrorFetchMode = 'always' | 'if-missing' | 'ttl';

export interface RemoteMirrorSpec {
  remoteUrl: string;
  baseBranch: string;
  fetchMode?: MirrorFetchMode;
  fetchTtlSeconds?: number;
  credentialEnv?: string;
}

export interface MirrorCacheOptions {
  /** Directory holding bare mirrors as <cacheRoot>/<slug>.git */
  cacheRoot: string;
  /** Lightweight lock directory to avoid duplicate fetches on one host. */
  lockRoot?: string;
  /** Resolve a repo slug to a local source path/URL to clone from. */
  sourceFor: (slug: string) => string | Promise<string>;
  /** When set, fetch-or-clone from a git remote instead of a local seed. */
  remoteFor?: (slug: string) => RemoteMirrorSpec | null | Promise<RemoteMirrorSpec | null>;
  resolveCredential?: (credentialEnv?: string) => string | null;
}

export interface MirrorResult {
  path: string;
  baseSha?: string;
}

async function hasGitHead(repoPath: string): Promise<boolean> {
  return fs.stat(path.join(repoPath, '.git', 'HEAD')).then(() => true).catch(() => false);
}

/** Resolve a repo-root-relative or absolute mirror source path. */
export function resolveMirrorSourcePath(raw: string, repoRoot: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
}

function mirrorDest(cacheRoot: string, slug: string): string {
  return path.join(cacheRoot, `${slug.replace(/\//g, '__')}.git`);
}

function fetchMarkerPath(mirrorPath: string): string {
  return path.join(mirrorPath, '.remote-agent-last-fetch');
}

async function readFetchAgeSeconds(mirrorPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(fetchMarkerPath(mirrorPath), 'utf8');
    const ts = Date.parse(raw.trim());
    if (Number.isNaN(ts)) return null;
    return Math.max(0, Math.floor((Date.now() - ts) / 1000));
  } catch {
    return null;
  }
}

async function stampFetch(mirrorPath: string): Promise<void> {
  await fs.writeFile(fetchMarkerPath(mirrorPath), `${new Date().toISOString()}\n`);
}

async function withAskPass<T>(
  token: string,
  fn: (extraEnv: Record<string, string>) => Promise<T>,
): Promise<T> {
  const askpassDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-askpass-'));
  const askpass = path.join(askpassDir, 'askpass.sh');
  await fs.writeFile(askpass, `#!/bin/sh\necho "${token.replace(/"/g, '\\"')}"\n`, { mode: 0o700 });
  try {
    return await fn(gitAskPassEnv(askpass));
  } finally {
    await fs.rm(askpassDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function gitExec(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await exec('git', args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}

async function resolveBaseSha(mirrorPath: string, baseBranch: string): Promise<string | undefined> {
  try {
    const { stdout } = await gitExec(['-C', mirrorPath, 'rev-parse', `refs/heads/${baseBranch}`]);
    const sha = stdout.trim();
    return sha.length > 0 ? sha : undefined;
  } catch {
    try {
      const { stdout } = await gitExec(['-C', mirrorPath, 'rev-parse', `origin/${baseBranch}`]);
      const sha = stdout.trim();
      return sha.length > 0 ? sha : undefined;
    } catch {
      return undefined;
    }
  }
}

function shouldFetch(
  exists: boolean,
  fetchMode: MirrorFetchMode,
  ageSeconds: number | null,
  ttlSeconds: number,
): boolean {
  if (!exists) return true;
  if (fetchMode === 'if-missing') return false;
  if (fetchMode === 'always') return true;
  if (ageSeconds == null) return true;
  return ageSeconds >= ttlSeconds;
}

async function withMirrorLock<T>(lockRoot: string, slug: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(lockRoot, { recursive: true });
  const lockPath = path.join(lockRoot, `${slug.replace(/\//g, '__')}.lock`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.close();
      try {
        return await fn();
      } finally {
        await fs.rm(lockPath, { force: true }).catch(() => {});
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Timed out waiting for mirror lock: ${slug}`);
}

async function cloneBareRemote(
  remoteUrl: string,
  dest: string,
  token: string,
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await withAskPass(token, (env) => gitExec(['clone', '--bare', gitCloneUrl(remoteUrl), dest], { env }));
}

async function fetchRemoteBranch(
  mirrorPath: string,
  baseBranch: string,
  token: string,
  remoteUrl: string,
): Promise<void> {
  const origin = gitCloneUrl(remoteUrl);
  await withAskPass(token, async (env) => {
    // Existing mirrors were cloned without a username; host git then treats the
    // PAT as HTTP Basic username and returns Access denied. Rewrite origin
    // before every fetch so retrying a cached mirror works.
    await gitExec(['-C', mirrorPath, 'remote', 'set-url', 'origin', origin], { env });
    await gitExec(['-C', mirrorPath, 'fetch', '--prune', 'origin', baseBranch], { env });
  });
}

/**
 * Ensure a bare mirror exists and is fresh enough for the configured policy.
 * Remote mirrors use host-side credentials only — never tokenized URLs.
 */
export async function ensureMirror(
  slug: string,
  opts: MirrorCacheOptions,
): Promise<MirrorResult> {
  const dest = mirrorDest(opts.cacheRoot, slug);
  const remote = opts.remoteFor ? await opts.remoteFor(slug) : null;
  const resolveCredential = opts.resolveCredential ?? resolveGitCredential;
  const lockRoot = opts.lockRoot ?? path.join(opts.cacheRoot, '.locks');

  if (remote) {
    const token = resolveCredential(remote.credentialEnv);
    if (!token) {
      throw new Error(
        `host git credential missing for repo ${slug} (set ${remote.credentialEnv ?? 'REMOTE_AGENT_GIT_TOKEN'})`,
      );
    }
    const fetchMode = remote.fetchMode ?? 'always';
    const ttlSeconds = remote.fetchTtlSeconds ?? 300;

    return withMirrorLock(lockRoot, slug, async () => {
      const exists = await fs.stat(path.join(dest, 'HEAD')).then(() => true).catch(() => false);
      const ageSeconds = exists ? await readFetchAgeSeconds(dest) : null;
      const doFetch = shouldFetch(exists, fetchMode, ageSeconds, ttlSeconds);

      try {
        if (!exists) {
          await cloneBareRemote(remote.remoteUrl, dest, token);
          await stampFetch(dest);
        } else if (doFetch) {
          await fetchRemoteBranch(dest, remote.baseBranch, token, remote.remoteUrl);
          await stampFetch(dest);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(safeGitError(message, token));
      }

      const baseSha = await resolveBaseSha(dest, remote.baseBranch);
      return { path: dest, baseSha };
    });
  }

  const exists = await fs.stat(path.join(dest, 'HEAD')).then(() => true).catch(() => false);
  if (exists) return { path: dest };

  await fs.mkdir(path.dirname(dest), { recursive: true });
  const source = await opts.sourceFor(slug);
  await gitExec(['clone', '--bare', source, dest]);
  return { path: dest };
}

/**
 * Clone-on-demand bare-mirror cache (v1 shortcut for B2.7). First use clones the source into
 * <cacheRoot>/<slug>.git; later uses reuse it unless `remoteFor` triggers fetch-or-clone.
 * Returns an async resolver; the caller resolves the path before building the (sync) manifest.
 */
export function makeMirrorCache(opts: MirrorCacheOptions): (slug: string) => Promise<string> {
  return async (slug: string): Promise<string> => {
    const result = await ensureMirror(slug, opts);
    return result.path;
  };
}

/**
 * Ensure a local git checkout exists for mirror bootstrap. When `seedPath` is
 * missing or not a repo, copy `templateDir` and `git init` there. The sample
 * checkout under `examples/git/` is not a standalone repo (it uses the
 * monorepo `.git`), so we materialize a real seed repo under `runs/seed/`.
 */
export async function ensureGitSeedRepo(seedPath: string, templateDir: string): Promise<string> {
  if (await hasGitHead(seedPath)) return seedPath;
  await fs.mkdir(seedPath, { recursive: true });
  await fs.cp(templateDir, seedPath, { recursive: true, force: true, filter: (src) => !src.endsWith('/.git') });
  // Empty template skips hook installation (needed in sandboxes that block .git/hooks writes).
  await gitExec(['init', '-b', 'main', '--template='], { cwd: seedPath });
  await gitExec(['config', 'user.email', 'remote-agent@local'], { cwd: seedPath });
  await gitExec(['config', 'user.name', 'remote-agent'], { cwd: seedPath });
  await gitExec(['add', '-A'], { cwd: seedPath });
  await gitExec(['commit', '-m', 'seed', '--no-gpg-sign'], { cwd: seedPath });
  return seedPath;
}
