import type { ResolvedSkill } from '@remote-sandbox-agents/skills';
import { readSkillMetadata, readSkillTree } from '@remote-sandbox-agents/skills';

import type { BundleSkill } from './task-bundle.js';

/** Load pinned resolved skills from disk into TaskBundle skill entries. */
export async function bundleSkillsFromPinned(
  pinned: readonly ResolvedSkill[],
): Promise<BundleSkill[]> {
  const out: BundleSkill[] = [];
  for (const skill of pinned) {
    const tree = await readSkillTree(skill.contentRef);
    const { metadata } = readSkillMetadata(tree);
    out.push({
      id: skill.id,
      version: skill.version,
      contentHash: skill.contentHash,
      riskClass: skill.riskClass,
      source: skill.source,
      description: metadata?.description ?? skill.id,
      files: tree.files,
    });
  }
  return out;
}

export function pinnedSkillsFromMetadata(meta: Record<string, unknown>): ResolvedSkill[] {
  const raw = meta.resolvedSkills;
  if (!Array.isArray(raw)) return [];
  const out: ResolvedSkill[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== 'string' || rec.id.length === 0) continue;
    if (typeof rec.contentRef !== 'string') continue;
    out.push({
      id: rec.id,
      version: typeof rec.version === 'string' ? rec.version : '0.0.0-unpinned',
      contentHash: typeof rec.contentHash === 'string' ? rec.contentHash : '',
      riskClass: rec.riskClass === 'shell' || rec.riskClass === 'network' ? rec.riskClass : 'readonly',
      source:
        rec.source === 'workspace' || rec.source === 'tenant' || rec.source === 'agent'
          ? rec.source
          : 'platform',
      contentRef: rec.contentRef,
    });
  }
  return out;
}
