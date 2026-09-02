import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScopePolicy } from '@remote-sandbox-agents/contracts';

export type MirrorFetchMode = 'always' | 'if-missing' | 'ttl';

/** A repo the service may mount into a worker sandbox for a project. */
export interface ProjectRepo {
  slug: string;
  provider: 'git' | 'local';
  baseBranch: string;
  /** Workspace-relative mount destination (default: slug-derived). */
  dest?: string;
  /** Host path or mirror source override for local git mounts. */
  mirrorSource?: string;
  /** HTTPS git remote (no embedded credentials). Takes precedence over mirrorSource. */
  remoteUrl?: string;
  /** Env var holding a host-side git token. Defaults to REMOTE_AGENT_GIT_TOKEN. */
  credentialEnv?: string;
  /** Mirror refresh policy for remote repos. Default `always` during internal alpha. */
  fetchMode?: MirrorFetchMode;
  /** TTL seconds when fetchMode is `ttl`. Default 300. */
  fetchTtlSeconds?: number;
  readOnly?: boolean;
}

/** Context layer materialized under `context/` in the worker workspace. */
export interface ProjectContextLayer {
  /** Workspace-relative path (e.g. `context/project-brief.md`). */
  path: string;
  content: string;
  /** Provenance label written into the file header. */
  source?: string;
  trustLevel?: 'trusted' | 'untrusted';
}

/** Per-project workspace policy: repos + context the service grants to sandboxed workers. */
export interface ProjectConfig {
  projectId: string;
  tenantId: string;
  repos: ProjectRepo[];
  contextLayers?: ProjectContextLayer[];
  /** Service-owned scope ceiling; intersected with the worker profile's scopePolicy. */
  scopePolicy?: Partial<ScopePolicy>;
  /** Default repo slugs when a task does not specify `metadata.repos`. */
  defaultRepos?: string[];
}

export interface ProjectsFile {
  projects: ProjectConfig[];
}

function defaultDest(slug: string): string {
  const leaf = slug.split('/').pop() ?? slug;
  return leaf.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

/** Normalize a project config (fill dest defaults). */
export function normalizeProjectConfig(config: ProjectConfig): ProjectConfig {
  return {
    ...config,
    repos: config.repos.map((repo) => ({
      ...repo,
      dest: repo.dest ?? defaultDest(repo.slug),
    })),
  };
}

/**
 * Load project workspace policy from a JSON file (`projects.json` keyed by projectId).
 * v1 file source; seam for a DB `projects` table later.
 */
export async function loadProjectsFile(filePath: string): Promise<Map<string, ProjectConfig>> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as ProjectsFile;
  const map = new Map<string, ProjectConfig>();
  for (const project of parsed.projects ?? []) {
    map.set(project.projectId, normalizeProjectConfig(project));
  }
  return map;
}

export class ProjectConfigRegistry {
  private readonly byProject = new Map<string, ProjectConfig>();

  constructor(projects: ProjectConfig[] = []) {
    for (const project of projects) this.byProject.set(project.projectId, normalizeProjectConfig(project));
  }

  static async fromFile(filePath: string): Promise<ProjectConfigRegistry> {
    const map = await loadProjectsFile(filePath);
    return new ProjectConfigRegistry([...map.values()]);
  }

  get(projectId: string): ProjectConfig | undefined {
    return this.byProject.get(projectId);
  }

  /** Fallback when no explicit project config exists (single-repo dev default). */
  fallback(projectId: string, tenantId: string, defaultRepoSlug: string): ProjectConfig {
    return normalizeProjectConfig({
      projectId,
      tenantId,
      repos: [{ slug: defaultRepoSlug, provider: 'local', baseBranch: 'main', dest: 'repo' }],
    });
  }

  resolve(projectId: string, tenantId: string, defaultRepoSlug: string): ProjectConfig {
    return this.get(projectId) ?? this.fallback(projectId, tenantId, defaultRepoSlug);
  }
}

/** Default projects config shipped for local dev (`packages/scheduler/assets/projects.json`). */
export function defaultProjectsFilePath(schedulerPackageRoot: string): string {
  return path.resolve(schedulerPackageRoot, 'assets/projects.json');
}
