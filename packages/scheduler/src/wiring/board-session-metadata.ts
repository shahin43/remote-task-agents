import type { BoardTask, EffectiveScope, MountRequest, ScopePolicy } from '@remote-sandbox-agents/contracts';
import { clampScope } from '@remote-sandbox-agents/orchestrator';
import type { AssigneeTarget } from '@remote-sandbox-agents/orchestrator';
import { AgentConfigLoader } from '@remote-sandbox-agents/orchestrator';
import {
  resolveSkills,
  type CatalogSkill,
  type DroppedSkill,
  type ResolvedSkill,
} from '@remote-sandbox-agents/skills';
import {
  parseTaskRepoSelection,
  resolveTaskRepoSlugs,
  repoSlugsToMounts,
} from './task-repo-selection.js';
import type { ProjectConfig, ProjectContextLayer } from './project-config.js';
import { ProjectConfigRegistry } from './project-config.js';
import { resolveRunnerCapabilities } from './worker-capabilities.js';

export interface BuildBoardSessionMetadataDeps {
  projects: ProjectConfigRegistry;
  configLoader: AgentConfigLoader;
  defaultRepoSlug: string;
  /** Platform + this profile's agent-owned skills. Omitted = no skills on the run. */
  skillCatalog?: (profileId?: string) => Promise<readonly CatalogSkill[]>;
}

function labelContext(layer: ProjectContextLayer): string {
  const source = layer.source ?? 'project-config';
  const trust = layer.trustLevel ?? 'untrusted';
  return [
    '---',
    `source: ${source}`,
    `trust_level: ${trust}`,
    '---',
    '',
    layer.content,
    '',
  ].join('\n');
}

function taskBriefContext(task: BoardTask): { path: string; content: string } {
  const body = task.body.trim();
  const content = [
    '# Task Brief',
    '',
    `## ${task.title}`,
    '',
    body || '(no description)',
    '',
  ].join('\n');
  return { path: 'context/task-brief.md', content };
}

function mergeScopePolicy(
  project: ProjectConfig,
  profilePolicy?: ScopePolicy,
): ScopePolicy {
  const projectPolicy = project.scopePolicy ?? {};
  const allowedRepos = profilePolicy?.allowedRepos
    ?? projectPolicy.allowedRepos
    ?? project.repos.map((r) => r.slug);
  return {
    allowedRepos,
    allowedMountTypes: profilePolicy?.allowedMountTypes
      ?? projectPolicy.allowedMountTypes
      ?? ['git'],
    pathAllowlist: profilePolicy?.pathAllowlist ?? projectPolicy.pathAllowlist,
    pathDenylist: profilePolicy?.pathDenylist ?? projectPolicy.pathDenylist,
    maxMountedPaths: profilePolicy?.maxMountedPaths ?? projectPolicy.maxMountedPaths,
    egressAllowlist: profilePolicy?.egressAllowlist ?? projectPolicy.egressAllowlist,
  };
}

function filterMountsToPolicy(mounts: MountRequest[], policy: ScopePolicy): MountRequest[] {
  return mounts.filter((m) => {
    if (!policy.allowedMountTypes.includes(m.kind)) return false;
    if (m.kind === 'git' && !policy.allowedRepos.includes(m.ref)) return false;
    return true;
  });
}

/**
 * Build session metadata for a board-routed worker/orchestrator session:
 * repo (first, back-compat), effectiveScope.mounts (multi-repo), contextFiles.
 */
export async function buildBoardSessionMetadata(
  deps: BuildBoardSessionMetadataDeps,
  task: BoardTask,
  target: AssigneeTarget,
): Promise<Record<string, unknown>> {
  const project = deps.projects.resolve(task.projectId, task.tenantId, deps.defaultRepoSlug);
  let profilePolicy: ScopePolicy | undefined;
  let runnerCapabilities = resolveRunnerCapabilities();
  if (target.kind !== 'human') {
    try {
      const cfg = await deps.configLoader.resolve(target.agentSpecId);
      profilePolicy = cfg.profile.scopePolicy;
      runnerCapabilities = resolveRunnerCapabilities(cfg.profile.capabilities);
    } catch {
      /* profile may be missing in tests */
    }
  }

  const policy = mergeScopePolicy(project, profilePolicy);
  const repoSlugs = resolveTaskRepoSlugs(task.metadata, project);
  const selectedRepos = project.repos.filter((r) => repoSlugs.includes(r.slug));
  const primarySlug = parseTaskRepoSelection(task.metadata)?.primaryRepo ?? repoSlugs[0];
  const primaryRepoEntry = selectedRepos.find((r) => r.slug === primarySlug) ?? selectedRepos[0];
  const permittedMounts = filterMountsToPolicy(repoSlugsToMounts(repoSlugs, project), policy);
  let effectiveScope: EffectiveScope;
  try {
    effectiveScope = clampScope({ mounts: permittedMounts }, policy);
  } catch {
    effectiveScope = { targetPaths: [], mounts: permittedMounts };
  }

  const contextFiles: Array<{ path: string; content: string }> = [
    taskBriefContext(task),
    ...(project.contextLayers ?? []).map((layer) => ({
      path: layer.path.startsWith('context/') ? layer.path : `context/${layer.path}`,
      content: labelContext(layer),
    })),
  ];

  let resolvedSkills: ResolvedSkill[] = [];
  let skillsDropped: DroppedSkill[] = [];
  if (target.kind !== 'human' && deps.skillCatalog) {
    try {
      const cfg = await deps.configLoader.resolve(target.agentSpecId);
      const available = await deps.skillCatalog(target.agentSpecId);
      const result = resolveSkills({
        selector: cfg.profile.skills,
        available,
        grantedCapabilities: runnerCapabilities,
        engine: cfg.profile.engine,
      });
      resolvedSkills = result.resolved;
      skillsDropped = result.dropped;
      if (resolvedSkills.length > 0 && !runnerCapabilities.includes('skills')) {
        runnerCapabilities = [...runnerCapabilities, 'skills'];
      }
    } catch {
      /* catalog or profile missing — run without skills */
    }
  }

  return {
    repo: primaryRepoEntry
      ? {
          provider: primaryRepoEntry.provider,
          projectId: primaryRepoEntry.slug,
          baseBranch: primaryRepoEntry.baseBranch,
          targetPaths: effectiveScope.targetPaths,
        }
      : undefined,
    effectiveScope: {
      ...effectiveScope,
      capabilities: runnerCapabilities,
      skills: resolvedSkills.map((s) => s.id),
    },
    resolvedSkills,
    skillsDropped,
    contextFiles,
    projectRepos: selectedRepos,
    selectedRepos: repoSlugs,
    primaryRepo: primarySlug,
  };
}
