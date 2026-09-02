import type { MountRequest } from '@remote-sandbox-agents/contracts';
import type { ProjectConfig, ProjectRepo } from './project-config.js';

/** Canonical metadata keys — any channel (board, Slack, API) uses the same shape. */
export const TASK_METADATA_REPOS = 'repos';
export const TASK_METADATA_PRIMARY_REPO = 'primaryRepo';

/** Repo entry exposed to UIs and external channels. */
export interface ProjectRepoCatalogEntry {
  slug: string;
  provider: ProjectRepo['provider'];
  baseBranch: string;
  dest: string;
  readOnly?: boolean;
  /** True when this slug is the project default (first in defaultRepos or catalog). */
  isDefault?: boolean;
}

/** Resolved repo set stored on a task and consumed by the worker scheduler. */
export interface TaskRepoSelection {
  repos: string[];
  primaryRepo: string;
}

export class TaskRepoSelectionError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_repo' | 'empty_selection' | 'invalid_primary',
    readonly details?: { unknownSlugs?: string[]; primaryRepo?: string },
  ) {
    super(message);
    this.name = 'TaskRepoSelectionError';
  }
}

/** Read repo selection from task metadata (board, Slack, API — same keys). */
export function parseTaskRepoSelection(metadata: Record<string, unknown>): TaskRepoSelection | null {
  const raw = metadata[TASK_METADATA_REPOS];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const repos = normalizeRepoSlugs(raw.filter((v): v is string => typeof v === 'string' && v.length > 0));
  if (repos.length === 0) return null;
  const primaryRaw = metadata[TASK_METADATA_PRIMARY_REPO];
  const primaryRepo = typeof primaryRaw === 'string' && primaryRaw.length > 0
    ? primaryRaw
    : repos[0]!;
  return { repos, primaryRepo };
}

/** Dedupe slugs while preserving order. */
export function normalizeRepoSlugs(slugs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of slugs) {
    const trimmed = slug.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function catalogFromProject(project: ProjectConfig): ProjectRepoCatalogEntry[] {
  const defaults = defaultRepoSlugsForProject(project);
  const defaultSet = new Set(defaults);
  return project.repos.map((repo) => ({
    slug: repo.slug,
    provider: repo.provider,
    baseBranch: repo.baseBranch,
    dest: repo.dest ?? repo.slug.split('/').pop() ?? repo.slug,
    readOnly: repo.readOnly,
    isDefault: defaultSet.has(repo.slug),
  }));
}

/** Default slugs when a task/channel does not specify repos. */
export function defaultRepoSlugsForProject(project: ProjectConfig): string[] {
  const configured = project.defaultRepos;
  if (configured?.length) {
    return normalizeRepoSlugs(configured.filter((s) => project.repos.some((r) => r.slug === s)));
  }
  return project.repos.map((r) => r.slug);
}

/**
 * Resolve the effective repo slugs for a task: explicit selection or project defaults.
 * Validates every slug exists in the project catalog.
 */
export function resolveTaskRepoSlugs(
  metadata: Record<string, unknown>,
  project: ProjectConfig,
): string[] {
  const explicit = parseTaskRepoSelection(metadata);
  const slugs = explicit?.repos ?? defaultRepoSlugsForProject(project);
  assertKnownSlugs(slugs, project);
  return slugs;
}

export function assertKnownSlugs(slugs: string[], project: ProjectConfig): void {
  const catalog = new Set(project.repos.map((r) => r.slug));
  const unknown = slugs.filter((s) => !catalog.has(s));
  if (unknown.length > 0) {
    throw new TaskRepoSelectionError(
      `Unknown repo slug(s): ${unknown.join(', ')}`,
      'unknown_repo',
      { unknownSlugs: unknown },
    );
  }
}

/** Build git mount requests for the resolved slugs (channel-agnostic). */
export function repoSlugsToMounts(slugs: string[], project: ProjectConfig): MountRequest[] {
  const bySlug = new Map(project.repos.map((r) => [r.slug, r]));
  return slugs.map((slug) => {
    const repo = bySlug.get(slug);
    if (!repo) {
      throw new TaskRepoSelectionError(`Unknown repo slug: ${slug}`, 'unknown_repo', { unknownSlugs: [slug] });
    }
    return {
      kind: 'git' as const,
      ref: repo.slug,
      dest: repo.dest ?? slug.split('/').pop() ?? slug,
      at: repo.baseBranch,
      readOnly: repo.readOnly,
    };
  });
}

/** Normalize + validate a write payload from any channel. */
export function normalizeTaskRepoWrite(input: {
  repos?: string[];
  primaryRepo?: string | null;
}, project: ProjectConfig): TaskRepoSelection {
  if (!input.repos?.length) {
    throw new TaskRepoSelectionError('At least one repo is required.', 'empty_selection');
  }
  const repos = normalizeRepoSlugs(input.repos);
  assertKnownSlugs(repos, project);
  const primaryRepo = input.primaryRepo?.trim() || repos[0]!;
  if (!repos.includes(primaryRepo)) {
    throw new TaskRepoSelectionError(
      `primaryRepo must be one of the selected repos: ${primaryRepo}`,
      'invalid_primary',
      { primaryRepo },
    );
  }
  return { repos, primaryRepo };
}

/** Metadata patch to persist on board_tasks (same for API, Slack adapter, etc.). */
export function taskRepoMetadataPatch(selection: TaskRepoSelection): Record<string, unknown> {
  return {
    [TASK_METADATA_REPOS]: selection.repos,
    [TASK_METADATA_PRIMARY_REPO]: selection.primaryRepo,
  };
}
