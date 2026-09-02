import path from 'node:path';

import { discoverSkillCatalog, type CatalogSkill, type DiscoveredCatalog } from '@remote-sandbox-agents/skills';

export interface LoadMergedSkillCatalogOptions {
  platformRoot: string;
  /** Profile-owned skills, e.g. `agents/<profile>/skills`. */
  agentSkillsRoot?: string;
}

/**
 * Platform catalog first, then this profile's agent-owned skills.
 * First writer wins on id so a profile cannot shadow a platform skill.
 */
export async function loadMergedSkillCatalog(
  opts: LoadMergedSkillCatalogOptions,
): Promise<DiscoveredCatalog> {
  const platform = await discoverSkillCatalog(opts.platformRoot, { source: 'platform' });
  const agent = opts.agentSkillsRoot
    ? await discoverSkillCatalog(opts.agentSkillsRoot, { source: 'agent' })
    : { skills: [], rejected: [] };

  const byId = new Map<string, CatalogSkill>();
  for (const skill of [...platform.skills, ...agent.skills]) {
    if (!byId.has(skill.metadata.id)) byId.set(skill.metadata.id, skill);
  }

  return {
    skills: [...byId.values()].sort((a, b) => (a.metadata.id < b.metadata.id ? -1 : 1)),
    rejected: [...platform.rejected, ...agent.rejected],
  };
}

export function agentSkillsRootFor(workerAssetsRoot: string, profileId: string): string {
  return path.join(workerAssetsRoot, 'agents', profileId, 'skills');
}
