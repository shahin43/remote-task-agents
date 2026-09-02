/**
 * The skill model. Pure data + no `@remote-sandbox-agents` dependencies so this package
 * can be bundled into the in-sandbox runner as well as used by the control plane.
 *
 * Format is deliberately the same as the `dns-sandbox-demo` catalog (and the
 * SKILL.md convention used by agent skills): a directory containing a
 * required `SKILL.md` with YAML frontmatter plus an optional
 * `skill.manifest.json`. Skills authored for either system therefore work in both.
 */

/**
 * How much a skill needs from the sandbox. Enforced against the run's granted
 * capabilities at resolution time — never left to the model to respect.
 */
export type SkillRiskClass = 'readonly' | 'shell' | 'network';

export const SKILL_RISK_CLASSES: readonly SkillRiskClass[] = ['readonly', 'shell', 'network'];

/** Ordering for "is this risk class within the allowed cap" comparisons. */
export const SKILL_RISK_ORDER: Record<SkillRiskClass, number> = {
  readonly: 0,
  shell: 1,
  network: 2,
};

/** Where a skill came from. Drives trust decisions (see the design spec, Decision 3). */
export type SkillSourceKind = 'platform' | 'workspace' | 'tenant' | 'agent';

/** Version used when a skill ships no manifest version; blocked in production tiers. */
export const UNPINNED_VERSION = '0.0.0-unpinned';

/** Canonical entry document inside a skill directory. */
export const SKILL_ENTRY = 'SKILL.md';

/** Optional per-skill catalog metadata file. */
export const SKILL_MANIFEST = 'skill.manifest.json';

/** One text file inside a skill directory, path relative to the skill root. */
export interface SkillFileEntry {
  path: string;
  content: string;
}

/** A skill directory read into memory. */
export interface SkillTree {
  /** Directory name on disk; may differ from the canonical id in frontmatter. */
  folder: string;
  files: SkillFileEntry[];
}

export interface SkillMetadata {
  /** Canonical id — the `name` in SKILL.md frontmatter. */
  id: string;
  /** Directory name the skill was read from. */
  folder: string;
  /** Manifest version, or `UNPINNED_VERSION`. */
  version: string;
  description: string;
  riskClass: SkillRiskClass;
  tags: string[];
  /** Engine kinds this skill supports; empty = any engine. */
  engines: string[];
  /** External tool dependencies the harness may need to provision. */
  toolDeps: string[];
  /** Capabilities the run must already grant for this skill to be usable. */
  requiredCapabilities: string[];
  entry: string;
  /** False when the version is `UNPINNED_VERSION`. */
  pinned: boolean;
}

export type SkillFindingLevel = 'error' | 'warning';

export interface SkillFinding {
  level: SkillFindingLevel;
  code: string;
  message: string;
  /** Skill-relative file path the finding refers to, when applicable. */
  path?: string;
}

/** A validated skill in a catalog, ready to be selected for a run. */
export interface CatalogSkill {
  metadata: SkillMetadata;
  /** Stable hash of the skill's file tree; what a run pins and the ledger records. */
  contentHash: string;
  source: SkillSourceKind;
  /** Opaque pointer the materializer uses to fetch content (fs path, S3 URI, …). */
  contentRef: string;
  tree: SkillTree;
}

/** The immutable per-run record of a staged skill. */
export interface ResolvedSkill {
  id: string;
  version: string;
  contentHash: string;
  riskClass: SkillRiskClass;
  source: SkillSourceKind;
  contentRef: string;
}

export type SkillDropReason =
  | 'not_found'
  | 'invalid'
  | 'engine_incompatible'
  | 'risk_exceeds_capabilities'
  | 'risk_exceeds_workspace_cap'
  | 'unpinned_version';

export interface DroppedSkill {
  id: string;
  reason: SkillDropReason;
  detail?: string;
}

/**
 * Which skills a profile wants. Structurally compatible with
 * `SkillSelector` in `@remote-sandbox-agents/contracts` so profile YAML flows straight in.
 */
export interface SkillSelector {
  mode: 'all' | 'tagged' | 'named';
  tags?: string[];
  names?: string[];
}
