import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readSkillTree, renderSkillsPromptSection, validateSkillTree, type SkillSourceKind } from '@remote-sandbox-agents/skills';

import { buildTaskBundle, type BundleSkill, type TaskBundle } from './task-bundle.js';

export const GUEST_LOOP_CAPABILITIES = ['filesystem', 'shell', 'skills'] as const;
export const GUEST_LOOP_GREETING_PATH = 'repo/GREETING.md';
export const GUEST_LOOP_GREETING_BODY = 'hello-fixture: ping\n';
export const GUEST_LOOP_SKILL_IDS = ['hello-fixture', 'repo-orientation'] as const;

const GUEST_LOOP_TASK = [
  'Load the available skills (read skills/INDEX.md, then read_skill for each id).',
  'Follow hello-fixture exactly: write repo/GREETING.md with the skill\'s required content.',
  'Do not edit other files. Stop when the greeting file exists.',
].join(' ');

export interface GuestLoopFixture {
  bundle: TaskBundle;
  repoDir: string;
  cleanup: () => Promise<void>;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

async function loadBundleSkill(dir: string, source: SkillSourceKind): Promise<BundleSkill> {
  const tree = await readSkillTree(dir);
  const result = validateSkillTree(tree, { source, contentRef: dir });
  if (!result.ok || !result.catalogSkill) {
    const detail = result.findings.map((f) => `${f.code}: ${f.message}`).join('; ') || 'unknown';
    throw new Error(`guest-loop fixture: skill at ${dir} is invalid (${detail})`);
  }
  const catalog = result.catalogSkill;
  return {
    id: catalog.metadata.id,
    version: catalog.metadata.version,
    contentHash: catalog.contentHash,
    riskClass: catalog.metadata.riskClass,
    source: catalog.source,
    description: catalog.metadata.description,
    files: catalog.tree.files,
  };
}

async function stageGitRepo(stage: string): Promise<string> {
  const repoDir = path.join(stage, 'repo');
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, 'README.md'), '# fixture repo\n');
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const run = (args: string[]): void => {
    const res = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', env: gitEnv });
    if (res.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
    }
  };
  run(['-c', 'core.hooksPath=/dev/null', 'init', '-b', 'main']);
  run(['add', 'README.md']);
  run(['-c', 'user.email=e2e@test', '-c', 'user.name=e2e', 'commit', '-m', 'fixture']);
  return repoDir;
}

/**
 * Independent guest-loop payload: mocked coder spec, platform + custom skills,
 * and a host-local git tree. Used by the fake unix-local proof and the live
 * Docker proof so both exercise TaskBundle → Manifest, not a hand-rolled tree.
 */
export async function buildGuestLoopFixture(): Promise<GuestLoopFixture> {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-guest-loop-'));
  const root = repoRoot();
  const repoDir = await stageGitRepo(stage);
  const platform = await loadBundleSkill(path.join(root, 'platform-skills', 'repo-orientation'), 'platform');
  const custom = await loadBundleSkill(
    path.join(root, 'images', 'pi-agent', 'e2e', 'fixtures', 'skills', 'hello-fixture'),
    'tenant',
  );
  const skills = [platform, custom];
  const skillIds = skills.map((s) => s.id).sort();
  const spec = {
    profileId: 'coder',
    provider: 'openai',
    model: 'gpt-5.4-mini',
    maxTurns: 12,
    systemPrompt: [
      'You are a coding agent running inside an isolated sandbox. Work in repo/.',
      renderSkillsPromptSection(skills),
    ].join('\n\n'),
    input: GUEST_LOOP_TASK,
    storeRequests: true,
  };
  const scope = {
    targetPaths: ['.'],
    capabilities: [...GUEST_LOOP_CAPABILITIES],
    skills: skillIds,
  };
  const bundle = buildTaskBundle({
    runId: 'guest-loop-e2e',
    agentsMd: '# Fixture workspace\nWork in repo/.\n',
    metadata: {
      goal: GUEST_LOOP_TASK,
      ticket: { key: 'GUEST-1', title: 'Guest loop greeting', description: GUEST_LOOP_TASK },
      repo: {
        provider: 'local',
        projectId: 'fixture/guest-loop',
        baseBranch: 'main',
        targetPaths: ['.'],
      },
      contextFiles: [{ path: 'task-brief.md', content: GUEST_LOOP_TASK }],
      effectiveScope: { targetPaths: ['.'], mounts: [] },
    },
    mirrorPathFor: () => repoDir,
    worktreePathFor: () => repoDir,
    skills,
    engineFiles: [
      { dest: '.agent/spec.json', content: JSON.stringify(spec) },
      { dest: 'task/scope.json', content: JSON.stringify(scope) },
    ],
  });
  return {
    bundle,
    repoDir,
    cleanup: async () => {
      await fs.rm(stage, { recursive: true, force: true });
    },
  };
}
