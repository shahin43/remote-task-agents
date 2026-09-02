import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createManifest } from '../manifest.js';
import { DockerSandboxProvider } from './docker.js';
import { DEFAULT_PI_AGENT_IMAGE, GUEST_IMAGE_ENGINE, GUEST_IMAGE_KIND } from '../guest-image.js';
import type { SandboxContainerInfo } from '../events.js';
import { dockerDaemonOk, resolveDockerBin } from '../testing/resolve-docker-bin.js';

const DOCKER = resolveDockerBin();
const dockerOk = dockerDaemonOk(DOCKER);
const imageOk = dockerOk
  && spawnSync(DOCKER, ['image', 'inspect', DEFAULT_PI_AGENT_IMAGE], { encoding: 'utf8' }).status === 0;
const skip = !dockerOk
  ? 'docker not available'
  : !imageOk
    ? `${DEFAULT_PI_AGENT_IMAGE} not built (npm run build:pi-agent-image)`
    : undefined;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const platformSkill = path.join(repoRoot, 'platform-skills', 'repo-orientation');
const customSkill = path.join(repoRoot, 'images', 'pi-agent', 'e2e', 'fixtures', 'skills', 'hello-fixture');

const mockedSpec = {
  profileId: 'coder',
  provider: 'openai',
  model: 'gpt-5.4-mini',
  maxTurns: 1,
  systemPrompt: 'You are a mocked coding agent for guest-image e2e.',
  input: 'Confirm repo/README.md exists. Do not make extra edits.',
};

const mockedScope = {
  targetPaths: ['.'],
  capabilities: ['filesystem', 'shell', 'skills'],
  skills: ['repo-orientation', 'hello-fixture'],
};

async function stageGitRepo(root: string): Promise<string> {
  const repoDir = path.join(root, 'repo');
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, 'README.md'), '# fixture repo\n');
  const init = spawnSync('git', ['init'], { cwd: repoDir, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  spawnSync('git', ['add', 'README.md'], { cwd: repoDir, encoding: 'utf8' });
  spawnSync(
    'git',
    ['-c', 'user.email=e2e@test', '-c', 'user.name=e2e', 'commit', '-m', 'fixture'],
    { cwd: repoDir, encoding: 'utf8' },
  );
  return repoDir;
}

test('pi-agent guest: independent e2e with mocked coder profile, skills, and git tree', { skip }, async () => {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-guest-e2e-'));
  const repoDir = await stageGitRepo(stage);
  const provider = new DockerSandboxProvider({
    dockerBin: DOCKER,
    image: DEFAULT_PI_AGENT_IMAGE,
    network: process.env.REMOTE_AGENT_GUEST_E2E_LIVE === '1',
  });
  const manifest = createManifest({
    entries: {
      repo: { type: 'local_dir', src: repoDir, dest: 'repo' },
      'skills/repo-orientation': { type: 'local_dir', src: platformSkill, dest: 'skills/repo-orientation' },
      'skills/hello-fixture': { type: 'local_dir', src: customSkill, dest: 'skills/hello-fixture' },
      'skills/INDEX.md': {
        type: 'inline_file',
        dest: 'skills/INDEX.md',
        content: '- repo-orientation (platform)\n- hello-fixture (custom fixture)\n',
      },
      'AGENTS.md': { type: 'inline_file', dest: 'AGENTS.md', content: '# Fixture workspace\nWork in repo/.\n' },
      'context/task-brief.md': {
        type: 'inline_file',
        dest: 'context/task-brief.md',
        content: 'Independent guest e2e. No control plane.\n',
      },
      'task/scope.json': { type: 'inline_file', dest: 'task/scope.json', content: JSON.stringify(mockedScope) },
      '.agent/spec.json': { type: 'inline_file', dest: '.agent/spec.json', content: JSON.stringify(mockedSpec) },
    },
    env: {},
    workspace: { writeAccess: 'rw' },
  });
  const session = await provider.create({ manifest, options: { type: 'docker' } });
  try {
    const identity = (session.state.container as SandboxContainerInfo | undefined)?.identity;
    assert.ok(identity?.digest?.startsWith('sha256:'), 'guest digest stamped');
    assert.equal(identity?.kind, GUEST_IMAGE_KIND);
    assert.equal(identity?.engine, GUEST_IMAGE_ENGINE);

    await session.start();

    const baked = await session.exec(['test', '-f', '/opt/worker/pi-runner.bundle.cjs'], { shell: false });
    assert.equal(baked.exitCode, 0, 'baked pi-runner missing from guest image');

    const spec = await session.exec(['cat', '.agent/spec.json'], { shell: false });
    assert.match(spec.stdout, /"profileId":"coder"/);

    const platform = await session.exec(['cat', 'skills/repo-orientation/SKILL.md'], { shell: false });
    assert.match(platform.stdout, /repo-orientation/);

    const custom = await session.exec(['cat', 'skills/hello-fixture/SKILL.md'], { shell: false });
    assert.match(custom.stdout, /Hello fixture/);

    const git = await session.exec(['git', '-C', '/workspace/repo', 'status'], { shell: false });
    assert.equal(git.exitCode, 0, git.stderr);

    const readme = await session.exec(['cat', 'repo/README.md'], { shell: false });
    assert.match(readme.stdout, /fixture repo/);

    if (process.env.REMOTE_AGENT_GUEST_E2E_LIVE === '1') {
      const live = await session.exec(
        ['node', '/opt/worker/pi-runner.bundle.cjs', '/workspace'],
        { shell: false, env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '' } },
      );
      assert.equal(live.exitCode, 0, `live pi-runner failed: ${live.stderr}\n${live.stdout}`);
      assert.match(live.stdout, /"status":"completed"/);
    }
  } finally {
    await provider.destroy(session);
    await fs.rm(stage, { recursive: true, force: true });
  }
});
