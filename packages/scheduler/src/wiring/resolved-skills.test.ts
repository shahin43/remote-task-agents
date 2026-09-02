import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { hashSkillTree, readSkillTree } from '@remote-sandbox-agents/skills';

import { bundleSkillsFromPinned } from './resolved-skills.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('bundleSkillsFromPinned loads SKILL.md from a pinned contentRef', async () => {
  const dir = path.join(repoRoot, 'platform-skills', 'repo-orientation');
  const tree = await readSkillTree(dir);
  const skills = await bundleSkillsFromPinned([{
    id: 'repo-orientation',
    version: '1.0.0',
    contentHash: hashSkillTree(tree.files),
    riskClass: 'shell',
    source: 'platform',
    contentRef: dir,
  }]);
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.id, 'repo-orientation');
  assert.ok(skills[0]?.files.some((f) => f.path === 'SKILL.md'));
  assert.match(skills[0]?.description ?? '', /Orient/i);
});
