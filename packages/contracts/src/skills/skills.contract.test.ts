import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillRef, SkillBody } from '../index.js';

test('SkillRef survives JSON round-trip', () => {
  const skill: SkillRef = {
    name: 'deploy-staging',
    source: 'repo',
    description: 'Deploy to staging environment via Vercel',
    tags: ['coding', 'deploy'],
    enabled: true,
  };

  const serialized = JSON.stringify(skill);
  const deserialized: SkillRef = JSON.parse(serialized);
  assert.deepEqual(deserialized, skill);
});

test('SkillRef with all optional fields', () => {
  const skill: SkillRef = {
    name: 'triage-linear',
    source: 'service',
    path: '.remote-agent/skills/triage-linear/SKILL.md',
    description: 'How to triage a Linear bug ticket',
    tags: ['triage'],
    requiresToolsets: ['filesystem-read'],
    enabled: true,
  };

  const serialized = JSON.stringify(skill);
  const deserialized: SkillRef = JSON.parse(serialized);
  assert.deepEqual(deserialized, skill);
  assert.deepEqual(deserialized.requiresToolsets, ['filesystem-read']);
});

test('SkillBody survives JSON round-trip', () => {
  const body: SkillBody = {
    name: 'deploy-staging',
    content: '# Deploy Staging\n\nRun `vercel deploy --env staging`.',
    frontmatter: { tags: ['coding', 'deploy'], version: 1 },
  };

  const serialized = JSON.stringify(body);
  const deserialized: SkillBody = JSON.parse(serialized);
  assert.deepEqual(deserialized, body);
});
