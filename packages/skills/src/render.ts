import type { SkillRiskClass } from './types.js';

/** Workspace-relative location of the generated skill index. */
export const SKILLS_INDEX_PATH = 'skills/INDEX.md';

/** The minimum a caller must know about a skill to advertise it to the model. */
export interface SkillIndexEntry {
  id: string;
  version: string;
  riskClass: SkillRiskClass;
  description: string;
}

/**
 * Render `skills/INDEX.md`.
 *
 * The index — not the skill bodies — is what the model sees up front, so first-turn
 * token cost stays flat as the catalog grows. Bodies load on demand via `read_skill`,
 * which also makes skill usage observable as tool events.
 */
export function renderSkillsIndex(entries: readonly SkillIndexEntry[]): string {
  const lines: string[] = [
    '# Available skills',
    '',
    'Load a skill with `read_skill(<id>)` before you use it. Skill payload files live',
    'under `skills/<id>/` and can be read with `read_file`.',
    '',
  ];

  if (entries.length === 0) {
    lines.push('No skills are available for this run.', '');
    return lines.join('\n');
  }

  lines.push('| id | version | risk | description |', '| --- | --- | --- | --- |');
  for (const entry of entries) {
    const description = entry.description.replace(/\s+/g, ' ').trim();
    lines.push(`| ${entry.id} | ${entry.version} | ${entry.riskClass} | ${escapeCell(description)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the system-prompt skills section.
 *
 * Kept to a few lines on purpose: it advertises existence and the loading protocol,
 * not content.
 */
export function renderSkillsPromptSection(entries: readonly { id: string }[]): string {
  if (entries.length === 0) return '';
  const ids = entries.map((s) => s.id).join(', ');
  return [
    '## Skills',
    '',
    `You have ${entries.length} skill(s) available for this run: ${ids}.`,
    'Read `skills/INDEX.md` for what each one does, then call `read_skill` with the',
    'skill id to load its instructions before using it. Follow a loaded skill exactly.',
  ].join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}
