import { createHash } from 'node:crypto';

import type { SkillFileEntry } from './types.js';

/**
 * Stable content hash over a skill's file tree.
 *
 * Path-sorted and length-delimited so that neither file ordering nor content
 * containing the delimiter can produce a collision. Two skills sharing an id but
 * not a hash are different skills — this is the value a run pins and the ledger
 * records for provenance.
 */
export function hashSkillTree(files: readonly SkillFileEntry[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const digest = createHash('sha256');
  for (const file of sorted) {
    digest.update(file.path);
    digest.update('\0');
    digest.update(String(Buffer.byteLength(file.content, 'utf8')));
    digest.update('\0');
    digest.update(file.content, 'utf8');
    digest.update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
}
