import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadMergedSkillCatalog } from './skill-catalog.js';

async function writeSkill(root: string, folder: string, name: string): Promise<void> {
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\nrisk_class: readonly\n---\n\n# ${name}\n`,
    'utf8',
  );
  await writeFile(
    path.join(dir, 'skill.manifest.json'),
    JSON.stringify({ name, version: '1.0.0', engines: ['pi-agent'] }),
    'utf8',
  );
}

test('loadMergedSkillCatalog unions platform + agent skills and keeps platform on id clash', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-'));
  const platform = path.join(root, 'platform');
  const agent = path.join(root, 'agent');
  await writeSkill(platform, 'warehouse', 'warehouse');
  await writeSkill(platform, 'clash', 'shared');
  await writeSkill(agent, 'chart', 'chart');
  await writeSkill(agent, 'clash', 'shared');

  const merged = await loadMergedSkillCatalog({ platformRoot: platform, agentSkillsRoot: agent });
  const ids = merged.skills.map((s) => s.metadata.id);
  assert.deepEqual(ids, ['chart', 'shared', 'warehouse']);
  const shared = merged.skills.find((s) => s.metadata.id === 'shared');
  assert.equal(shared?.source, 'platform');
  const chart = merged.skills.find((s) => s.metadata.id === 'chart');
  assert.equal(chart?.source, 'agent');
});
