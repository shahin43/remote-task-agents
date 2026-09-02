import { createManifest, type Manifest, type Entry } from '@remote-sandbox-agents/sandbox';

export interface BuildWorkerManifestInput {
  /** Resolved AGENTS.md content (profile asset + optional orchestrator overlay). */
  agentsMd: string;
  /** The worker session's metadata (goal, ticket, repo, orchestratorNotes, effectiveScope, contextFiles). */
  metadata: Record<string, unknown>;
  /** The worker run id, used in the dev branch name. */
  runId: string;
/** Map a repo slug to its local mirror path (orchestrator-maintained mirror; D8). */
  mirrorPathFor: (repo: string) => string;
  /**
   * When set, repos are staged on the host as real git checkouts and copied into the
   * workspace via `local_dir` (OpenAI Agents SDK pattern). Avoids in-container clone
   * and docker bind-mounts of bare mirrors.
   */
  worktreePathFor?: (dest: string, ref: string, baseRef: string) => string;
  /**
   * Optional workspace policy declaration. When unset the worker manifest defaults
   * to `writeAccess: 'rw'` so the agent can edit code; runtimes that copy host-uid
   * files into the container (docker) use this to chown the tree to the runtime user.
   */
  workspace?: { writeAccess?: 'rw' | 'ro'; runAs?: { uid: number; gid: number } };
}

interface TicketMeta { key: string; title: string; description?: string; url?: string }
interface RepoMeta { provider: string; projectId: string; baseBranch: string; targetPaths: string[] }
interface MountReq { kind: 'git' | 's3'; ref: string; dest: string; at?: string; readOnly?: boolean }
interface EffScope { targetPaths: string[]; mounts: MountReq[] }

/**
 * Pure: worker session metadata + resolved AGENTS.md → sandbox Manifest.
 * Produces: AGENTS.md (inline at root), context/session-context.md (inline),
 * any contextFiles (inline), and a git_mount cloned from the local mirror onto a dev branch.
 * NOT wired into the live loop in B1 — consumed by WorkerScheduler in B2.
 */
export function buildWorkerManifest(input: BuildWorkerManifestInput): Manifest {
  const meta = input.metadata;
  const entries: Record<string, Entry> = {};

  // 1. AGENTS.md at workspace root (The agent reads it natively from cwd).
  entries['AGENTS.md'] = { type: 'inline_file', dest: 'AGENTS.md', content: input.agentsMd };

  // 2. Session context as a markdown file under context/.
  entries['context/session-context.md'] = {
    type: 'inline_file',
    dest: 'context/session-context.md',
    content: renderSessionContext(meta),
  };

  // 3. Any orchestrator-provided context files (already in-memory).
  const contextFiles = meta.contextFiles as Array<{ path: string; content: string }> | undefined;
  for (const f of contextFiles ?? []) {
    const dest = f.path.startsWith('context/') ? f.path : `context/${f.path}`;
    entries[dest] = { type: 'inline_file', dest, content: f.content };
  }

  // 4. Git mounts — prefer effectiveScope mounts (all), else fall back to repo metadata.
  const eff = meta.effectiveScope as EffScope | undefined;
  const repo = meta.repo as RepoMeta | undefined;
  const ticket = meta.ticket as TicketMeta | undefined;
  const branchKey = ticket?.key ?? 'task';
  const workingBranch = `agent/${branchKey}-${input.runId}`;

  const gitMounts = (eff?.mounts ?? []).filter((m) => m.kind === 'git');
  const addGitRepo = (dest: string, ref: string, baseRef: string) => {
    if (input.worktreePathFor) {
      entries[dest] = {
        type: 'local_dir',
        src: input.worktreePathFor(dest, ref, baseRef),
        dest,
      };
      entries[`${dest}__git_capture`] = {
        type: 'git_mount',
        provider: 'local',
        repo: '',
        baseRef,
        dest,
        workingBranch,
        captureOnly: true,
      };
      return;
    }
    entries[dest] = {
      type: 'git_mount',
      provider: 'local',
      repo: input.mirrorPathFor(ref),
      baseRef,
      dest,
      workingBranch,
    };
  };

  if (gitMounts.length > 0) {
    for (const mount of gitMounts) {
      addGitRepo(mount.dest, mount.ref, mount.at ?? repo?.baseBranch ?? 'main');
    }
  } else if (repo) {
    addGitRepo('repo', repo.projectId, repo.baseBranch);
  }

  // Default to 'rw': workers need to edit files inside their workspace. The
  // docker provider uses this to chown /workspace to the container's runtime
  // user after every materialize and hydrate pass, closing the host-uid /
  // container-uid mismatch that previously surfaced as EACCES.
  const workspacePolicy = input.workspace ?? { writeAccess: 'rw' as const };
  return createManifest({ entries, env: {}, workspace: workspacePolicy });
}

/**
 * Container-wide env for a worker runtime.
 *
 * The docker runtime needs AGENT_HOME so the in-container engine resolves its config
 * dir. The OpenAI API key is deliberately NOT here: it reaches the engine via explicit
 * login-over-stdio, keeping it out of the container-wide env (`docker create
 * --env`) and therefore out of snapshot artifacts (review H1/H2). unix-local
 * needs nothing — the engine runs as a host process under the host env.
 */
export function manifestEnvForRuntime(runtime: string): Record<string, string> {
  if (runtime === 'sandbox-docker') {
    return { AGENT_HOME: '/workspace/.agent' };
  }
  return {};
}

/**
 * Exported so `buildTaskBundle` renders byte-identical session context; the
 * equivalence test between the bundle and this builder depends on one implementation.
 */
export function renderSessionContext(meta: Record<string, unknown>): string {
  const lines: string[] = ['# Worker Session Context', '', '## Goal', '', String(meta.goal ?? '(none)'), ''];
  const ticket = meta.ticket as TicketMeta | undefined;
  if (ticket) {
    lines.push('## Source Ticket', '', `- Key: ${ticket.key}`, `- Title: ${ticket.title}`);
    if (ticket.url) lines.push(`- URL: ${ticket.url}`);
    lines.push('', '### Description', '', ticket.description ?? '(no description)', '');
  }
  const repo = meta.repo as RepoMeta | undefined;
  if (repo) {
    lines.push('## Repository', '', `- Provider: ${repo.provider}`, `- Project: ${repo.projectId}`, `- Base branch: ${repo.baseBranch}`, '');
  }
  if (meta.orchestratorNotes) {
    lines.push('## Orchestrator Notes', '', String(meta.orchestratorNotes), '');
  }
  return lines.join('\n');
}
