import { createManifest, type Entry, type Manifest } from '@remote-sandbox-agents/sandbox';
import {
  SKILLS_INDEX_PATH,
  renderSkillsIndex,
  type SkillRiskClass,
  type SkillSourceKind,
} from '@remote-sandbox-agents/skills';

import { renderSessionContext } from './build-worker-manifest.js';

/**
 * The single sandbox handover contract.
 *
 * A `TaskBundle` describes *what one run's workspace contains*, with no reference to
 * how it gets there. Backends supply a materializer: docker stages to the host and
 * copies in, remote guest packs a tar and uploads it as the snapshot seed, unix-local writes
 * directly. Before this existed the same information was spread across
 * `buildWorkerManifest`, `piRunnerTemplate.materialize`, and `hydrateWorkspace` — each
 * host-path-bound, so a second backend had to re-implement all three.
 *
 * Two rules keep it useful:
 * - **No secrets.** Credentials are referenced (env name / SSM path), never inlined,
 *   so a bundle is safe to persist, hash, and ship to an object store.
 * - **Deterministic.** Same inputs produce the same bundle, which is what lets the
 *   docker materializer be proven byte-identical to the old path and lets seeds be
 *   content-addressed.
 *
 * Engine neutrality is deliberate. `pi-agent` needs `.agent/spec.json` +
 * `task/scope.json`; `pi-agent` needs skills projected into `$AGENT_HOME/skills/`.
 * Those are *engine contributions* (`engineFiles`, `engineDirs`), not bundle concepts,
 * so adding an engine never means changing the handover contract.
 */
export interface TaskBundle {
  version: 1;
  runId: string;
  /** Directories to create even when empty (the canonical workspace layout). */
  dirs: string[];
  /** Text files written verbatim into the workspace. */
  files: BundleFile[];
  /** Host files copied in as-is (the pi-runner bundle). */
  assets: BundleAsset[];
  /** Repo working trees to place at their mount destinations. */
  repos: BundleRepo[];
  /** Resolved, pinned skills staged under `skills/<id>/`. */
  skills: BundleSkill[];
  /** Container-wide env. References only — never credential values. */
  env: Record<string, string>;
  workspace: { writeAccess: 'rw' | 'ro'; runAs?: { uid: number; gid: number } };
}

export interface BundleFile {
  dest: string;
  content: string;
}

export interface BundleAsset {
  dest: string;
  srcPath: string;
}

export interface BundleRepo {
  dest: string;
  /** Repo slug / mirror ref. */
  ref: string;
  baseRef: string;
  workingBranch: string;
  /** Host worktree to copy in. When absent the materializer clones from `mirrorPath`. */
  worktreePath?: string;
  mirrorPath: string;
}

export interface BundleSkill {
  id: string;
  version: string;
  contentHash: string;
  riskClass: SkillRiskClass;
  source: SkillSourceKind;
  description: string;
  /** Skill-relative files; staged at `skills/<id>/<path>`. */
  files: Array<{ path: string; content: string }>;
}

/** The canonical workspace layout, created even when a section is empty. */
export const BUNDLE_DIRS = ['.agent', 'task', 'context', 'skills', 'artifacts', 'repo'];

export interface BuildTaskBundleInput {
  runId: string;
  /** Resolved AGENTS.md content for the profile. */
  agentsMd: string;
  /** Worker session metadata (goal, ticket, repo, effectiveScope, contextFiles). */
  metadata: Record<string, unknown>;
  mirrorPathFor: (repo: string) => string;
  worktreePathFor?: (dest: string, ref: string, baseRef: string) => string;
  /** Resolved skills for this run; already clamped by capabilities and risk. */
  skills?: BundleSkill[];
  /** Engine-specific files (e.g. pi's `.agent/spec.json`, `task/scope.json`). */
  engineFiles?: BundleFile[];
  /** Engine-specific host assets (e.g. the pi-runner bundle). */
  engineAssets?: BundleAsset[];
  env?: Record<string, string>;
  workspace?: { writeAccess?: 'rw' | 'ro'; runAs?: { uid: number; gid: number } };
}

interface TicketMeta { key: string; title: string; description?: string; url?: string }
interface RepoMeta { provider: string; projectId: string; baseBranch: string; targetPaths: string[] }
interface MountReq { kind: 'git' | 's3'; ref: string; dest: string; at?: string; readOnly?: boolean }
interface EffScope { targetPaths: string[]; mounts: MountReq[] }

/** Pure: session metadata + resolved skills + engine contributions → a `TaskBundle`. */
const DEFAULT_RUNNER_CAPABILITIES = ['filesystem', 'shell', 'apply_patch', 'handoff'];

/** Pi `task/scope.json` for the seed. remote guest has no later materialize step. */
export function runnerScopeFileFromMetadata(metadata: Record<string, unknown>): BundleFile {
  const eff = metadata.effectiveScope as
    | { targetPaths?: string[]; capabilities?: string[]; skills?: string[] }
    | undefined;
  return {
    dest: 'task/scope.json',
    content: JSON.stringify(
      {
        targetPaths: eff?.targetPaths?.length ? eff.targetPaths : ['.'],
        capabilities: eff?.capabilities?.length ? eff.capabilities : DEFAULT_RUNNER_CAPABILITIES,
        skills: eff?.skills ?? [],
      },
      null,
      2,
    ),
  };
}

export function buildTaskBundle(input: BuildTaskBundleInput): TaskBundle {
  const meta = input.metadata;
  const files: BundleFile[] = [
    { dest: 'AGENTS.md', content: input.agentsMd },
    { dest: 'context/session-context.md', content: renderSessionContext(meta) },
  ];

  const contextFiles = meta.contextFiles as Array<{ path: string; content: string }> | undefined;
  for (const file of contextFiles ?? []) {
    const dest = file.path.startsWith('context/') ? file.path : `context/${file.path}`;
    files.push({ dest, content: file.content });
  }

  const skills = [...(input.skills ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (skills.length > 0) {
    files.push({
      dest: SKILLS_INDEX_PATH,
      content: renderSkillsIndex(
        skills.map((s) => ({
          id: s.id,
          version: s.version,
          riskClass: s.riskClass,
          description: s.description,
        })),
      ),
    });
  }

  files.push(...(input.engineFiles ?? []));

  const eff = meta.effectiveScope as EffScope | undefined;
  const repoMeta = meta.repo as RepoMeta | undefined;
  const ticket = meta.ticket as TicketMeta | undefined;
  const workingBranch = `agent/${ticket?.key ?? 'task'}-${input.runId}`;

  const repos: BundleRepo[] = [];
  const addRepo = (dest: string, ref: string, baseRef: string): void => {
    repos.push({
      dest,
      ref,
      baseRef,
      workingBranch,
      worktreePath: input.worktreePathFor?.(dest, ref, baseRef),
      mirrorPath: input.mirrorPathFor(ref),
    });
  };

  const gitMounts = (eff?.mounts ?? []).filter((m) => m.kind === 'git');
  if (gitMounts.length > 0) {
    for (const mount of gitMounts) {
      addRepo(mount.dest, mount.ref, mount.at ?? repoMeta?.baseBranch ?? 'main');
    }
  } else if (repoMeta) {
    addRepo('repo', repoMeta.projectId, repoMeta.baseBranch);
  }

  return {
    version: 1,
    runId: input.runId,
    dirs: [...BUNDLE_DIRS],
    files,
    assets: [...(input.engineAssets ?? [])],
    repos,
    skills,
    env: { ...(input.env ?? {}) },
    workspace: {
      writeAccess: input.workspace?.writeAccess ?? 'rw',
      ...(input.workspace?.runAs ? { runAs: input.workspace.runAs } : {}),
    },
  };
}

/**
 * Docker / unix-local materialization step 1: bundle → sandbox `Manifest`.
 *
 * Skills and inline files become `inline_file` entries; repos become a `local_dir`
 * copy plus a `captureOnly` git mount when a host worktree exists, else a `git_mount`
 * cloned from the mirror — matching what `buildWorkerManifest` has always produced.
 * Host assets (the runner bundle) stay outside the manifest because they are written
 * through the session after create, exactly as `piRunnerTemplate` does today.
 */
export function bundleToManifest(bundle: TaskBundle): Manifest {
  const entries: Record<string, Entry> = {};

  for (const file of bundle.files) {
    entries[file.dest] = { type: 'inline_file', dest: file.dest, content: file.content };
  }

  for (const skill of bundle.skills) {
    for (const file of skill.files) {
      const dest = `skills/${skill.id}/${file.path}`;
      entries[dest] = { type: 'inline_file', dest, content: file.content };
    }
  }

  for (const repo of bundle.repos) {
    if (repo.worktreePath) {
      entries[repo.dest] = { type: 'local_dir', src: repo.worktreePath, dest: repo.dest };
      entries[`${repo.dest}__git_capture`] = {
        type: 'git_mount',
        provider: 'local',
        repo: '',
        baseRef: repo.baseRef,
        dest: repo.dest,
        workingBranch: repo.workingBranch,
        captureOnly: true,
      };
      continue;
    }
    entries[repo.dest] = {
      type: 'git_mount',
      provider: 'local',
      repo: repo.mirrorPath,
      baseRef: repo.baseRef,
      dest: repo.dest,
      workingBranch: repo.workingBranch,
    };
  }

  return createManifest({ entries, env: bundle.env, workspace: bundle.workspace });
}
