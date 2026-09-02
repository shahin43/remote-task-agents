import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { SKILL_ENTRY, type CatalogSkill, type SkillFinding, type SkillSourceKind, type SkillTree } from './types.js';
import { validateSkillTree, type SkillValidationLimits } from './validate.js';

/** Directory entries never treated as skill payload. */
const IGNORED = new Set(['.git', 'node_modules', '.DS_Store', 'dist', '.tsbuildinfo']);

export interface DiscoverSkillsOptions {
  source?: SkillSourceKind;
  limits?: Partial<SkillValidationLimits>;
  /**
   * Prefix for each skill's `contentRef`. Defaults to the catalog root, so a
   * materializer can resolve content without re-deriving paths.
   */
  contentRefPrefix?: string;
}

export interface DiscoveredCatalog {
  /** Skills that validated cleanly, sorted by id. */
  skills: CatalogSkill[];
  /** Directories that looked like skills but failed validation. */
  rejected: Array<{ folder: string; findings: SkillFinding[] }>;
}

/**
 * Read one skill directory into memory.
 *
 * v1 skills are text-only: content is read as UTF-8 and a NUL byte is reported as a
 * finding rather than silently corrupting the content hash.
 */
export async function readSkillTree(dir: string, folder?: string): Promise<SkillTree> {
  const files: SkillTree['files'] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(abs, rel);
      else if (entry.isFile()) files.push({ path: rel, content: await readFile(abs, 'utf8') });
    }
  }
  await walk(dir, '');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { folder: folder ?? path.basename(dir), files };
}

/**
 * Scan a catalog root (e.g. `platform-skills/`, a repo's `.remote-agent/skills/`, or
 * the remote guest image's `/opt/platform-skills`) for directories containing a `SKILL.md`.
 *
 * A directory without `SKILL.md` is skipped silently — catalog roots legitimately hold
 * README files and tooling. A directory *with* one that fails validation is reported in
 * `rejected` so operators see why a skill did not load instead of it vanishing.
 */
export async function discoverSkillCatalog(
  root: string,
  options: DiscoverSkillsOptions = {},
): Promise<DiscoveredCatalog> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { skills: [], rejected: [] };
  }

  const prefix = options.contentRefPrefix ?? root;
  const skills: CatalogSkill[] = [];
  const rejected: DiscoveredCatalog['rejected'] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED.has(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const tree = await readSkillTree(dir, entry.name);
    if (!tree.files.some((f) => f.path === SKILL_ENTRY)) continue;

    const binary = tree.files.filter((f) => f.content.includes('\u0000'));
    const result = validateSkillTree(tree, {
      source: options.source ?? 'platform',
      contentRef: `${prefix}/${entry.name}`,
      limits: options.limits,
    });
    const findings = [
      ...result.findings,
      ...binary.map((f): SkillFinding => ({
        level: 'error',
        code: 'binary_file_unsupported',
        message: 'Skill payload files must be UTF-8 text in v1.',
        path: f.path,
      })),
    ];

    if (result.ok && binary.length === 0 && result.catalogSkill) skills.push(result.catalogSkill);
    else rejected.push({ folder: entry.name, findings });
  }

  skills.sort((a, b) => (a.metadata.id < b.metadata.id ? -1 : a.metadata.id > b.metadata.id ? 1 : 0));
  return { skills, rejected };
}
