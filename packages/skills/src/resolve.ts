import {
  SKILL_RISK_ORDER,
  type CatalogSkill,
  type DroppedSkill,
  type ResolvedSkill,
  type SkillRiskClass,
  type SkillSelector,
} from './types.js';

export interface ResolveSkillsInput {
  /** Profile intent. Defaults to `{ mode: 'all' }` when omitted. */
  selector?: SkillSelector;
  /** Validated skills available from all sources for this run. */
  available: readonly CatalogSkill[];
  /** Capabilities the run actually grants (post-clamp). */
  grantedCapabilities: readonly string[];
  /** Workspace ceiling on risk class; skills above it are dropped. */
  maxRiskClass?: SkillRiskClass;
  /** Engine kind of the run, e.g. `pi-agent`. Checked against `metadata.engines`. */
  engine?: string;
  /** When true, unpinned (versionless) skills are refused. */
  requirePinnedVersions?: boolean;
}

export interface ResolveSkillsResult {
  /** Skills to stage, sorted by id so the bundle is deterministic. */
  resolved: ResolvedSkill[];
  /** Everything excluded, with a machine-readable reason for the task comment. */
  dropped: DroppedSkill[];
}

/**
 * Decide which skills a run may use.
 *
 * Runs on the control side, before any sandbox exists, and the result is pinned onto
 * the session so a mid-run catalog edit cannot change a live run. Enforcement here is
 * deliberate: the alternative is telling the model which skills it may use and hoping,
 * which is not a security boundary.
 */
export function resolveSkills(input: ResolveSkillsInput): ResolveSkillsResult {
  const selector: SkillSelector = input.selector ?? { mode: 'all' };
  const granted = new Set(input.grantedCapabilities);
  const cap = input.maxRiskClass ? SKILL_RISK_ORDER[input.maxRiskClass] : undefined;

  const resolved: ResolvedSkill[] = [];
  const dropped: DroppedSkill[] = [];

  const byId = new Map<string, CatalogSkill>();
  for (const skill of input.available) {
    // First writer wins so source precedence is the caller's choice of array order.
    if (!byId.has(skill.metadata.id)) byId.set(skill.metadata.id, skill);
  }

  let candidates: CatalogSkill[];
  if (selector.mode === 'named') {
    candidates = [];
    for (const name of selector.names ?? []) {
      const found = byId.get(name);
      if (found) candidates.push(found);
      else dropped.push({ id: name, reason: 'not_found', detail: 'no such skill in any source' });
    }
  } else if (selector.mode === 'tagged') {
    const wanted = new Set(selector.tags ?? []);
    candidates = [...byId.values()].filter((s) => s.metadata.tags.some((t) => wanted.has(t)));
  } else {
    candidates = [...byId.values()];
  }

  for (const skill of candidates) {
    const { metadata } = skill;

    if (input.engine && metadata.engines.length > 0 && !metadata.engines.includes(input.engine)) {
      dropped.push({
        id: metadata.id,
        reason: 'engine_incompatible',
        detail: `supports ${metadata.engines.join(', ')}; run uses ${input.engine}`,
      });
      continue;
    }

    if (cap !== undefined && SKILL_RISK_ORDER[metadata.riskClass] > cap) {
      dropped.push({
        id: metadata.id,
        reason: 'risk_exceeds_workspace_cap',
        detail: `risk ${metadata.riskClass} above workspace cap ${input.maxRiskClass}`,
      });
      continue;
    }

    const missing = metadata.requiredCapabilities.filter((c) => !granted.has(c));
    if (missing.length > 0) {
      dropped.push({
        id: metadata.id,
        reason: 'risk_exceeds_capabilities',
        detail: `missing capabilities: ${missing.join(', ')}`,
      });
      continue;
    }

    if (input.requirePinnedVersions && !metadata.pinned) {
      dropped.push({
        id: metadata.id,
        reason: 'unpinned_version',
        detail: 'no version declared in skill.manifest.json',
      });
      continue;
    }

    resolved.push({
      id: metadata.id,
      version: metadata.version,
      contentHash: skill.contentHash,
      riskClass: metadata.riskClass,
      source: skill.source,
      contentRef: skill.contentRef,
    });
  }

  resolved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  dropped.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { resolved, dropped };
}
