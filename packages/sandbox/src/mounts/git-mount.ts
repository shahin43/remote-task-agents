import { MountConfigError } from '../errors.js';
import { assertWorkspaceRelative, registerEntryParser, type Entry } from '../manifest.js';
import { execOk } from '../types.js';
import type { SandboxSession } from '../session.js';
import { registerMount, type Mount } from './mount.js';

export interface GitMountSpec {
  type: 'git_mount';
  provider: 'git' | 'github' | 'local';
  repo: string;        // for 'local': a filesystem path/URL to clone; otherwise host path/slug
  baseRef: string;     // branch/tag/sha to start from
  dest: string;        // workspace-relative
  workingBranch: string;
  depth?: number;      // shallow clone depth; default 1
  /** When true, repo was staged on the host (`local_dir`); only run snapshot capture. */
  captureOnly?: boolean;
}

export class GitMount implements Mount {
  readonly type = 'git_mount';
  readonly dest: string;
  constructor(private readonly spec: GitMountSpec) {
    assertWorkspaceRelative(spec.dest);
    this.dest = spec.dest;
  }

  async activate(session: SandboxSession): Promise<void> {
    if (this.spec.captureOnly) return;
    const depth = this.spec.depth ?? 1;
    // Docker bind-mounts expose host-owned git mirrors to a container user with a
    // different uid; git refuses to clone unless the directory is marked safe.
    if (this.spec.repo.startsWith('/')) {
      await session.exec(
        ['git', 'config', '--global', '--add', 'safe.directory', this.spec.repo],
        { shell: false },
      );
    }
    // Clone baseRef into dest. For 'local' provider the repo is a local path (mirror/origin).
    // --no-hardlinks: Docker bind-mounts ./runs with a host uid; hardlinked
    // 0444 git objects then fail chmod (EACCES) when Node/git retouches them.
    const clone = await session.exec(
      [
        'git',
        'clone',
        '--no-hardlinks',
        '--depth',
        String(depth),
        '--branch',
        this.spec.baseRef,
        this.spec.repo,
        this.spec.dest,
      ],
      { shell: false },
    );
    if (!execOk(clone)) {
      throw new MountConfigError('git clone failed', { stderr: clone.stderr, repo: this.spec.repo, baseRef: this.spec.baseRef });
    }
    const branch = await session.exec(['git', '-C', this.spec.dest, 'checkout', '-b', this.spec.workingBranch], { shell: false });
    if (!execOk(branch)) {
      throw new MountConfigError('git checkout -b failed', { stderr: branch.stderr, workingBranch: this.spec.workingBranch });
    }
  }

  async capture(session: SandboxSession): Promise<Record<string, unknown>> {
    const baseSha = (await session.exec(['git', '-C', this.spec.dest, 'merge-base', this.spec.baseRef, 'HEAD'], { shell: false })).stdout.trim()
      || (await session.exec(['git', '-C', this.spec.dest, 'rev-parse', `${this.spec.baseRef}`], { shell: false })).stdout.trim();
    const diff = await session.exec(['git', '-C', this.spec.dest, 'diff', `${baseSha}..HEAD`], { shell: false });
    const log = await session.exec(['git', '-C', this.spec.dest, 'log', '--format=%H %s', `${baseSha}..HEAD`], { shell: false });
    return {
      workingBranch: this.spec.workingBranch,
      baseSha,
      changesPatch: diff.stdout,
      commits: log.stdout.trim().split('\n').filter(Boolean),
    };
  }
}

export function parseGitMountEntry(raw: Record<string, unknown>): Entry {
  if (raw.captureOnly !== true) {
    for (const k of ['provider', 'repo', 'baseRef', 'dest', 'workingBranch']) {
      if (typeof raw[k] !== 'string') throw new MountConfigError(`git_mount requires string ${k}`, { raw });
    }
  } else {
    for (const k of ['baseRef', 'dest', 'workingBranch']) {
      if (typeof raw[k] !== 'string') throw new MountConfigError(`git_mount requires string ${k}`, { raw });
    }
  }
  assertWorkspaceRelative(raw.dest as string);
  return raw as unknown as Entry;
}

// Register so manifests can carry git_mount entries and the manager can build the Mount.
registerEntryParser('git_mount', parseGitMountEntry);
registerMount('git_mount', (entry) => new GitMount(entry as unknown as GitMountSpec));
