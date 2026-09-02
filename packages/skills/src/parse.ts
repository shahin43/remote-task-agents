import yaml from 'js-yaml';

import {
  SKILL_ENTRY,
  SKILL_MANIFEST,
  SKILL_RISK_CLASSES,
  UNPINNED_VERSION,
  type SkillFinding,
  type SkillMetadata,
  type SkillRiskClass,
  type SkillTree,
} from './types.js';

export interface ParsedSkillDoc {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split a `SKILL.md` into YAML frontmatter and markdown body. A document without
 * frontmatter parses as `{}` + the whole document, so callers report the missing
 * fields rather than failing to read the file at all.
 */
export function parseSkillDoc(raw: string): ParsedSkillDoc {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { frontmatter: {}, body: raw.replace(/^\uFEFF/, '') };
  let parsed: unknown;
  try {
    parsed = yaml.load(match[1] ?? '');
  } catch {
    parsed = undefined;
  }
  const frontmatter =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { frontmatter, body: raw.slice(match[0].length) };
}

interface MetadataResult {
  metadata: SkillMetadata | null;
  findings: SkillFinding[];
}

/**
 * Derive skill metadata from a read skill directory.
 *
 * Frontmatter is authoritative for identity (`name`) and description; the optional
 * `skill.manifest.json` supplies catalog facts (version, engines, toolDeps). Where
 * both declare a field, the manifest wins for catalog facts and frontmatter wins
 * for identity — so a skill can be re-versioned without editing its prose.
 */
export function readSkillMetadata(tree: SkillTree): MetadataResult {
  const findings: SkillFinding[] = [];
  const entry = tree.files.find((f) => f.path === SKILL_ENTRY);
  if (!entry) {
    findings.push({
      level: 'error',
      code: 'missing_skill_md',
      message: `Skill directory "${tree.folder}" has no ${SKILL_ENTRY}.`,
    });
    return { metadata: null, findings };
  }

  const { frontmatter } = parseSkillDoc(entry.content);
  const manifest = readManifest(tree, findings);

  const id = firstString(frontmatter.name, manifest?.name);
  if (!id) {
    findings.push({
      level: 'error',
      code: 'missing_name',
      message: `${SKILL_ENTRY} frontmatter must declare a "name".`,
      path: SKILL_ENTRY,
    });
  }

  const description = firstString(frontmatter.description, manifest?.description);
  if (!description) {
    findings.push({
      level: 'error',
      code: 'missing_description',
      message: `${SKILL_ENTRY} frontmatter must declare a "description".`,
      path: SKILL_ENTRY,
    });
  }

  const declaredRisk = firstString(
    frontmatter.risk_class,
    frontmatter.riskClass,
    manifest?.risk_class,
    manifest?.riskClass,
  );
  let riskClass: SkillRiskClass = 'readonly';
  if (declaredRisk) {
    if (isRiskClass(declaredRisk)) {
      riskClass = declaredRisk;
    } else {
      findings.push({
        level: 'error',
        code: 'invalid_risk_class',
        message: `Unknown risk_class "${declaredRisk}"; expected one of ${SKILL_RISK_CLASSES.join(', ')}.`,
        path: SKILL_ENTRY,
      });
    }
  } else {
    findings.push({
      level: 'warning',
      code: 'risk_class_defaulted',
      message: 'No risk_class declared; defaulting to "readonly".',
      path: SKILL_ENTRY,
    });
  }

  const version = firstString(manifest?.version) ?? UNPINNED_VERSION;
  const pinned = version !== UNPINNED_VERSION;
  if (!pinned) {
    findings.push({
      level: 'warning',
      code: 'unpinned_version',
      message: `No version in ${SKILL_MANIFEST}; treated as unpinned.`,
    });
  }

  if (!id || !description || findings.some((f) => f.code === 'invalid_risk_class')) {
    return { metadata: null, findings };
  }

  const declaredCaps = stringArray(
    frontmatter.required_capabilities ?? frontmatter.requiredCapabilities,
  ).concat(stringArray(manifest?.requiredCapabilities));

  return {
    metadata: {
      id,
      folder: tree.folder,
      version,
      description,
      riskClass,
      tags: unique(stringArray(frontmatter.tags).concat(stringArray(manifest?.tags))),
      engines: unique(stringArray(frontmatter.engines).concat(stringArray(manifest?.engines))),
      toolDeps: unique(stringArray(frontmatter.tool_deps).concat(stringArray(manifest?.toolDeps))),
      requiredCapabilities: requiredCapabilitiesFor(riskClass, declaredCaps),
      entry: firstString(manifest?.entry) ?? SKILL_ENTRY,
      pinned,
    },
    findings,
  };
}

/**
 * Capabilities a skill needs, derived from its risk class and merged with any it
 * declares explicitly. `network` skills that name no capability fall back to
 * `network` so they can never resolve into a run that was granted nothing.
 */
export function requiredCapabilitiesFor(
  riskClass: SkillRiskClass,
  declared: readonly string[] = [],
): string[] {
  const caps = new Set(declared);
  if (riskClass === 'shell') caps.add('shell');
  if (riskClass === 'network' && caps.size === 0) caps.add('network');
  return [...caps].sort();
}

function readManifest(tree: SkillTree, findings: SkillFinding[]): Record<string, any> | null {
  const file = tree.files.find((f) => f.path === SKILL_MANIFEST);
  if (!file) return null;
  try {
    const parsed = JSON.parse(file.content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
    findings.push({
      level: 'error',
      code: 'invalid_manifest',
      message: `${SKILL_MANIFEST} must contain a JSON object.`,
      path: SKILL_MANIFEST,
    });
  } catch (err) {
    findings.push({
      level: 'error',
      code: 'invalid_manifest',
      message: `${SKILL_MANIFEST} is not valid JSON: ${(err as Error).message}`,
      path: SKILL_MANIFEST,
    });
  }
  return null;
}

function isRiskClass(value: string): value is SkillRiskClass {
  return (SKILL_RISK_CLASSES as readonly string[]).includes(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
