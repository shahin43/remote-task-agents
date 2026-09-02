import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { discoverSkillCatalog, readSkillTree } from './discover.js';
import { SKILL_ENTRY } from './types.js';

async function catalogRoot(
  layout: Record<string, Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'skills-'));
  for (const [folder, files] of Object.entries(layout)) {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, folder, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
  }
  return root;
}

const DOC = (name: string, extra = '') =>
  `---\nname: ${name}\ndescription: does ${name}\n${extra}---\n\n# ${name}\n`;

test('readSkillTree reads nested payload files with relative paths', async () => {
  const root = await catalogRoot({
    alpha: { [SKILL_ENTRY]: DOC('alpha'), 'scripts/run.sh': 'echo hi\n' },
  });
  const tree = await readSkillTree(path.join(root, 'alpha'));
  assert.equal(tree.folder, 'alpha');
  assert.deepEqual(tree.files.map((f) => f.path), [SKILL_ENTRY, 'scripts/run.sh']);
});

test('readSkillTree skips ignored directories and junk files', async () => {
  const root = await catalogRoot({
    alpha: {
      [SKILL_ENTRY]: DOC('alpha'),
      'node_modules/dep/index.js': 'x',
      'dist/built.js': 'y',
      '.DS_Store': 'z',
    },
  });
  const tree = await readSkillTree(path.join(root, 'alpha'));
  assert.deepEqual(tree.files.map((f) => f.path), [SKILL_ENTRY]);
});

test('discoverSkillCatalog loads valid skills sorted by id and pins contentRef', async () => {
  const root = await catalogRoot({
    zebra: { [SKILL_ENTRY]: DOC('zebra'), 'skill.manifest.json': '{"version":"2.0.0"}' },
    'alpha-skill': { [SKILL_ENTRY]: DOC('alpha') },
  });
  const { skills, rejected } = await discoverSkillCatalog(root);
  assert.deepEqual(rejected, []);
  assert.deepEqual(skills.map((s) => s.metadata.id), ['alpha', 'zebra']);
  // Folder name and canonical id may differ; contentRef tracks the folder.
  assert.equal(skills[0]?.contentRef, `${root}/alpha-skill`);
  assert.equal(skills[1]?.metadata.version, '2.0.0');
  assert.equal(skills[0]?.source, 'platform');
});

test('discoverSkillCatalog ignores directories without SKILL.md', async () => {
  const root = await catalogRoot({
    alpha: { [SKILL_ENTRY]: DOC('alpha') },
    docs: { 'README.md': 'not a skill' },
  });
  const { skills, rejected } = await discoverSkillCatalog(root);
  assert.deepEqual(skills.map((s) => s.metadata.id), ['alpha']);
  assert.deepEqual(rejected, []);
});

test('discoverSkillCatalog reports invalid skills instead of dropping them silently', async () => {
  const root = await catalogRoot({
    broken: { [SKILL_ENTRY]: '---\ntags: [x]\n---\nno name or description' },
  });
  const { skills, rejected } = await discoverSkillCatalog(root);
  assert.deepEqual(skills, []);
  assert.equal(rejected[0]?.folder, 'broken');
  assert.ok(rejected[0]?.findings.some((f) => f.code === 'missing_name'));
});

test('discoverSkillCatalog rejects binary payload files in v1', async () => {
  const root = await catalogRoot({
    alpha: { [SKILL_ENTRY]: DOC('alpha'), 'bin/blob': 'head\u0000tail' },
  });
  const { skills, rejected } = await discoverSkillCatalog(root);
  assert.deepEqual(skills, []);
  assert.ok(rejected[0]?.findings.some((f) => f.code === 'binary_file_unsupported'));
});

test('discoverSkillCatalog tags the source it was told to use', async () => {
  const root = await catalogRoot({ alpha: { [SKILL_ENTRY]: DOC('alpha') } });
  const { skills } = await discoverSkillCatalog(root, { source: 'workspace' });
  assert.equal(skills[0]?.source, 'workspace');
});

test('discoverSkillCatalog returns empty for a missing root rather than throwing', async () => {
  const result = await discoverSkillCatalog(path.join(tmpdir(), 'does-not-exist-skills-root'));
  assert.deepEqual(result, { skills: [], rejected: [] });
});

test('the shipped platform-skills catalog validates', async () => {
  const root = path.resolve(import.meta.dirname, '../../../platform-skills');
  const { skills, rejected } = await discoverSkillCatalog(root);
  assert.deepEqual(rejected, [], `rejected: ${JSON.stringify(rejected)}`);
  assert.ok(skills.length >= 1, 'expected at least one shipped platform skill');
  const orientation = skills.find((s) => s.metadata.id === 'repo-orientation');
  assert.ok(orientation, 'repo-orientation skill should load');
  assert.equal(orientation.metadata.version, '1.0.0');
  assert.equal(orientation.metadata.riskClass, 'shell');
  assert.deepEqual(orientation.metadata.requiredCapabilities, ['shell']);
});
