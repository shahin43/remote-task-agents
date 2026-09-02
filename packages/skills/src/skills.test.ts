import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashSkillTree } from './hash.js';
import { parseSkillDoc, readSkillMetadata, requiredCapabilitiesFor } from './parse.js';
import { renderSkillsIndex, renderSkillsPromptSection } from './render.js';
import { resolveSkills } from './resolve.js';
import { UNPINNED_VERSION, type CatalogSkill, type SkillTree } from './types.js';
import { validateSkillTree } from './validate.js';

function tree(folder: string, files: Record<string, string>): SkillTree {
  return { folder, files: Object.entries(files).map(([path, content]) => ({ path, content })) };
}

const GOOD_SKILL = `---
name: warehouse
description: >
  Query warehouse via the Data API and summarise results.
risk_class: network
required_capabilities: [warehouse]
tags: [data, analytics]
---

# Warehouse

Steps to run a query.
`;

function catalogEntry(overrides: Partial<CatalogSkill['metadata']> & { id: string }): CatalogSkill {
  return {
    metadata: {
      id: overrides.id,
      folder: overrides.folder ?? overrides.id,
      version: overrides.version ?? '1.0.0',
      description: overrides.description ?? `does ${overrides.id}`,
      riskClass: overrides.riskClass ?? 'readonly',
      tags: overrides.tags ?? [],
      engines: overrides.engines ?? [],
      toolDeps: overrides.toolDeps ?? [],
      requiredCapabilities:
        overrides.requiredCapabilities ??
        requiredCapabilitiesFor(overrides.riskClass ?? 'readonly', []),
      entry: 'SKILL.md',
      pinned: overrides.pinned ?? (overrides.version ?? '1.0.0') !== UNPINNED_VERSION,
    },
    contentHash: `sha256:${overrides.id}`,
    source: 'platform',
    contentRef: `platform-skills/${overrides.id}`,
    tree: tree(overrides.id, { 'SKILL.md': '' }),
  };
}

// ---------------------------------------------------------------- parse

test('parseSkillDoc reads frontmatter and leaves the body intact', () => {
  const { frontmatter, body } = parseSkillDoc(GOOD_SKILL);
  assert.equal(frontmatter.name, 'warehouse');
  assert.match(String(frontmatter.description), /Query warehouse/);
  assert.match(body, /^\n?# Warehouse/);
});

test('parseSkillDoc tolerates a document with no frontmatter', () => {
  const { frontmatter, body } = parseSkillDoc('# Just markdown\n');
  assert.deepEqual(frontmatter, {});
  assert.equal(body, '# Just markdown\n');
});

test('readSkillMetadata derives id, risk class and declared capabilities', () => {
  const { metadata, findings } = readSkillMetadata(tree('warehouse-skill', { 'SKILL.md': GOOD_SKILL }));
  assert.ok(metadata);
  assert.equal(metadata.id, 'warehouse');
  // Folder name and canonical id are allowed to differ.
  assert.equal(metadata.folder, 'warehouse-skill');
  assert.equal(metadata.riskClass, 'network');
  assert.deepEqual(metadata.requiredCapabilities, ['warehouse']);
  assert.deepEqual(metadata.tags, ['data', 'analytics']);
  assert.equal(metadata.version, UNPINNED_VERSION);
  assert.equal(metadata.pinned, false);
  assert.ok(findings.some((f) => f.code === 'unpinned_version' && f.level === 'warning'));
});

test('readSkillMetadata takes version and engines from skill.manifest.json', () => {
  const { metadata } = readSkillMetadata(
    tree('warehouse-skill', {
      'SKILL.md': GOOD_SKILL,
      'skill.manifest.json': JSON.stringify({ version: '1.2.0', engines: ['pi-agent'] }),
    }),
  );
  assert.ok(metadata);
  assert.equal(metadata.version, '1.2.0');
  assert.equal(metadata.pinned, true);
  assert.deepEqual(metadata.engines, ['pi-agent']);
});

test('readSkillMetadata fails a skill with no SKILL.md', () => {
  const { metadata, findings } = readSkillMetadata(tree('broken', { 'README.md': 'hi' }));
  assert.equal(metadata, null);
  assert.ok(findings.some((f) => f.code === 'missing_skill_md'));
});

test('readSkillMetadata requires name and description', () => {
  const { metadata, findings } = readSkillMetadata(
    tree('bare', { 'SKILL.md': '---\ntags: [x]\n---\nbody' }),
  );
  assert.equal(metadata, null);
  assert.ok(findings.some((f) => f.code === 'missing_name'));
  assert.ok(findings.some((f) => f.code === 'missing_description'));
});

test('readSkillMetadata rejects an unknown risk class rather than defaulting it', () => {
  const { metadata, findings } = readSkillMetadata(
    tree('x', { 'SKILL.md': '---\nname: x\ndescription: d\nrisk_class: root\n---\n' }),
  );
  assert.equal(metadata, null);
  assert.ok(findings.some((f) => f.code === 'invalid_risk_class'));
});

test('readSkillMetadata defaults an undeclared risk class to readonly with a warning', () => {
  const { metadata, findings } = readSkillMetadata(
    tree('x', { 'SKILL.md': '---\nname: x\ndescription: d\n---\n' }),
  );
  assert.equal(metadata?.riskClass, 'readonly');
  assert.ok(findings.some((f) => f.code === 'risk_class_defaulted'));
});

test('requiredCapabilitiesFor derives capabilities from risk class', () => {
  assert.deepEqual(requiredCapabilitiesFor('readonly'), []);
  assert.deepEqual(requiredCapabilitiesFor('shell'), ['shell']);
  // A network skill naming nothing still cannot land in a run granted nothing.
  assert.deepEqual(requiredCapabilitiesFor('network'), ['network']);
  assert.deepEqual(requiredCapabilitiesFor('network', ['warehouse']), ['warehouse']);
  assert.deepEqual(requiredCapabilitiesFor('shell', ['warehouse']), ['shell', 'warehouse']);
});

// ---------------------------------------------------------------- hash

test('hashSkillTree ignores file ordering', () => {
  const a = hashSkillTree([
    { path: 'SKILL.md', content: 'one' },
    { path: 'scripts/run.sh', content: 'two' },
  ]);
  const b = hashSkillTree([
    { path: 'scripts/run.sh', content: 'two' },
    { path: 'SKILL.md', content: 'one' },
  ]);
  assert.equal(a, b);
});

test('hashSkillTree changes when any content changes', () => {
  const before = hashSkillTree([{ path: 'SKILL.md', content: 'one' }]);
  const after = hashSkillTree([{ path: 'SKILL.md', content: 'onf' }]);
  assert.notEqual(before, after);
});

test('hashSkillTree is length-delimited so path/content shifts cannot collide', () => {
  const a = hashSkillTree([
    { path: 'a', content: 'xy' },
    { path: 'b', content: '' },
  ]);
  const b = hashSkillTree([
    { path: 'a', content: 'x' },
    { path: 'b', content: 'y' },
  ]);
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------- validate

test('validateSkillTree accepts a well-formed skill and returns a catalog entry', () => {
  const result = validateSkillTree(
    tree('warehouse-skill', {
      'SKILL.md': GOOD_SKILL,
      'skill.manifest.json': JSON.stringify({ version: '1.0.0' }),
    }),
    { source: 'platform', contentRef: 'platform-skills/warehouse-skill' },
  );
  assert.equal(result.ok, true);
  assert.ok(result.catalogSkill);
  assert.equal(result.catalogSkill.metadata.id, 'warehouse');
  assert.match(result.catalogSkill.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.catalogSkill.source, 'platform');
});

test('validateSkillTree blocks a skill carrying a credential', () => {
  const result = validateSkillTree(
    tree('leaky', {
      'SKILL.md': '---\nname: leaky\ndescription: d\n---\n',
      'scripts/run.sh': `export OPENAI_API_KEY=sk-${'A'.repeat(24)}\n`,
    }),
  );
  assert.equal(result.ok, false);
  const finding = result.findings.find((f) => f.code === 'secret_detected');
  assert.ok(finding);
  assert.equal(finding.path, 'scripts/run.sh');
});

test('validateSkillTree blocks path traversal in the payload tree', () => {
  const result = validateSkillTree(
    tree('escape', {
      'SKILL.md': '---\nname: escape\ndescription: d\n---\n',
      '../../etc/passwd': 'x',
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'unsafe_path'));
});

test('validateSkillTree enforces size limits', () => {
  const result = validateSkillTree(
    tree('big', { 'SKILL.md': '---\nname: big\ndescription: d\n---\n' + 'x'.repeat(200) }),
    { limits: { maxFileBytes: 50, maxTotalBytes: 50 } },
  );
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'file_too_large'));
  assert.ok(result.findings.some((f) => f.code === 'skill_too_large'));
});

test('validateSkillTree reports invalid manifest JSON', () => {
  const result = validateSkillTree(
    tree('bad', { 'SKILL.md': '---\nname: bad\ndescription: d\n---\n', 'skill.manifest.json': '{' }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'invalid_manifest'));
});

// ---------------------------------------------------------------- resolve

test('resolveSkills with mode=all returns every compatible skill, sorted by id', () => {
  const result = resolveSkills({
    available: [catalogEntry({ id: 'zebra' }), catalogEntry({ id: 'alpha' })],
    grantedCapabilities: ['filesystem'],
  });
  assert.deepEqual(result.resolved.map((s) => s.id), ['alpha', 'zebra']);
  assert.deepEqual(result.dropped, []);
});

test('resolveSkills mode=named reports unknown ids as not_found', () => {
  const result = resolveSkills({
    selector: { mode: 'named', names: ['alpha', 'ghost'] },
    available: [catalogEntry({ id: 'alpha' })],
    grantedCapabilities: [],
  });
  assert.deepEqual(result.resolved.map((s) => s.id), ['alpha']);
  assert.deepEqual(result.dropped, [
    { id: 'ghost', reason: 'not_found', detail: 'no such skill in any source' },
  ]);
});

test('resolveSkills mode=tagged selects on tag intersection', () => {
  const result = resolveSkills({
    selector: { mode: 'tagged', tags: ['analytics'] },
    available: [
      catalogEntry({ id: 'alpha', tags: ['analytics'] }),
      catalogEntry({ id: 'beta', tags: ['coding'] }),
    ],
    grantedCapabilities: [],
  });
  assert.deepEqual(result.resolved.map((s) => s.id), ['alpha']);
});

test('resolveSkills drops a skill whose risk class exceeds granted capabilities', () => {
  const result = resolveSkills({
    available: [catalogEntry({ id: 'runner', riskClass: 'shell' })],
    grantedCapabilities: ['filesystem'],
  });
  assert.deepEqual(result.resolved, []);
  assert.equal(result.dropped[0]?.reason, 'risk_exceeds_capabilities');
  assert.match(String(result.dropped[0]?.detail), /shell/);
});

test('resolveSkills admits the same skill once the capability is granted', () => {
  const result = resolveSkills({
    available: [catalogEntry({ id: 'runner', riskClass: 'shell' })],
    grantedCapabilities: ['filesystem', 'shell'],
  });
  assert.deepEqual(result.resolved.map((s) => s.id), ['runner']);
});

test('resolveSkills honours the workspace risk cap even when capabilities allow it', () => {
  const result = resolveSkills({
    available: [catalogEntry({ id: 'runner', riskClass: 'shell' })],
    grantedCapabilities: ['shell'],
    maxRiskClass: 'readonly',
  });
  assert.deepEqual(result.resolved, []);
  assert.equal(result.dropped[0]?.reason, 'risk_exceeds_workspace_cap');
});

test('resolveSkills drops engine-incompatible skills', () => {
  const result = resolveSkills({
    available: [catalogEntry({ id: 'engineonly', engines: ['other-engine'] })],
    grantedCapabilities: [],
    engine: 'pi-agent',
  });
  assert.equal(result.dropped[0]?.reason, 'engine_incompatible');
});

test('resolveSkills can refuse unpinned versions', () => {
  const unpinned = catalogEntry({ id: 'draft', version: UNPINNED_VERSION });
  assert.equal(
    resolveSkills({ available: [unpinned], grantedCapabilities: [] }).resolved.length,
    1,
  );
  const strict = resolveSkills({
    available: [unpinned],
    grantedCapabilities: [],
    requirePinnedVersions: true,
  });
  assert.deepEqual(strict.resolved, []);
  assert.equal(strict.dropped[0]?.reason, 'unpinned_version');
});

test('resolveSkills dedupes ids by source precedence (array order)', () => {
  const platform = catalogEntry({ id: 'shared', version: '1.0.0' });
  const workspace: CatalogSkill = { ...catalogEntry({ id: 'shared', version: '9.9.9' }), source: 'workspace' };
  const result = resolveSkills({
    available: [platform, workspace],
    grantedCapabilities: [],
  });
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0]?.version, '1.0.0');
  assert.equal(result.resolved[0]?.source, 'platform');
});

test('resolveSkills pins hash, version and source onto the result', () => {
  const result = resolveSkills({
    available: [catalogEntry({ id: 'alpha', version: '2.1.0' })],
    grantedCapabilities: [],
  });
  assert.deepEqual(result.resolved[0], {
    id: 'alpha',
    version: '2.1.0',
    contentHash: 'sha256:alpha',
    riskClass: 'readonly',
    source: 'platform',
    contentRef: 'platform-skills/alpha',
  });
});

// ---------------------------------------------------------------- render

test('renderSkillsIndex lists skills and escapes pipes in descriptions', () => {
  const index = renderSkillsIndex([
    { id: 'warehouse', version: '1.0.0', riskClass: 'readonly', description: 'Query Warehouse | safely' },
  ]);
  assert.match(index, /# Available skills/);
  assert.match(index, /\| warehouse \| 1\.0\.0 \| readonly \| Query Warehouse \\\| safely \|/);
  assert.match(index, /read_skill/);
});

test('renderSkillsIndex collapses multi-line descriptions onto one row', () => {
  const index = renderSkillsIndex([
    { id: 'wrapped', version: '1.0.0', riskClass: 'shell', description: 'line one\n  line two\n' },
  ]);
  assert.match(index, /\| wrapped \| 1\.0\.0 \| shell \| line one line two \|/);
});

test('renderSkillsIndex says so when a run has no skills', () => {
  assert.match(renderSkillsIndex([]), /No skills are available/);
});

test('renderSkillsPromptSection is empty without skills and names ids with them', () => {
  assert.equal(renderSkillsPromptSection([]), '');
  const section = renderSkillsPromptSection([{ id: 'alpha' }, { id: 'beta' }]);
  assert.match(section, /## Skills/);
  assert.match(section, /2 skill\(s\).*alpha, beta/);
  assert.match(section, /read_skill/);
});
