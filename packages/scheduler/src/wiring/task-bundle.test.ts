import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildWorkerManifest } from './build-worker-manifest.js';
import { BUNDLE_DIRS, bundleToManifest, buildTaskBundle, runnerScopeFileFromMetadata, type BundleSkill } from './task-bundle.js';

const RUN_ID = 'run-123';

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goal: 'Append a line to the README',
    ticket: { key: 'TASK-1', title: 'Ticket title', description: 'Ticket body', url: 'https://x/1' },
    repo: {
      provider: 'local',
      projectId: 'sample/service',
      baseBranch: 'main',
      targetPaths: ['.'],
    },
    orchestratorNotes: 'be careful',
    contextFiles: [
      { path: 'task-brief.md', content: '# brief' },
      { path: 'context/project-overview.md', content: '# overview' },
    ],
    effectiveScope: { targetPaths: ['.'], mounts: [] },
    ...overrides,
  };
}

const mirrorPathFor = (slug: string): string => `/mirrors/${slug.replace('/', '__')}.git`;
const worktreePathFor = (dest: string): string => `/worktrees/${dest}`;

function skill(id: string, files: Record<string, string>): BundleSkill {
  return {
    id,
    version: '1.0.0',
    contentHash: `sha256:${id}`,
    riskClass: 'readonly',
    source: 'platform',
    description: `does ${id}`,
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  };
}

/**
 * The equivalence tests are the safety rail for the refactor: the bundle path must
 * produce exactly what the live manifest builder produces before any call site moves
 * over to it.
 */
test('bundle → manifest equals buildWorkerManifest on the worktree path', () => {
  const meta = metadata();
  const viaBundle = bundleToManifest(
    buildTaskBundle({ runId: RUN_ID, agentsMd: '# Worker', metadata: meta, mirrorPathFor, worktreePathFor }),
  );
  const direct = buildWorkerManifest({
    agentsMd: '# Worker',
    metadata: meta,
    runId: RUN_ID,
    mirrorPathFor,
    worktreePathFor,
  });
  assert.deepEqual(viaBundle, direct);
});

test('bundle → manifest equals buildWorkerManifest on the in-container clone path', () => {
  const meta = metadata();
  const viaBundle = bundleToManifest(
    buildTaskBundle({ runId: RUN_ID, agentsMd: '# Worker', metadata: meta, mirrorPathFor }),
  );
  const direct = buildWorkerManifest({
    agentsMd: '# Worker',
    metadata: meta,
    runId: RUN_ID,
    mirrorPathFor,
  });
  assert.deepEqual(viaBundle, direct);
});

test('bundle → manifest equals buildWorkerManifest for multi-repo scope mounts', () => {
  const meta = metadata({
    effectiveScope: {
      targetPaths: ['.'],
      mounts: [
        { kind: 'git', ref: 'sample/service', dest: 'repo', at: 'main' },
        { kind: 'git', ref: 'sample/shared-lib', dest: 'shared-lib' },
        { kind: 's3', ref: 'bucket/prefix', dest: 'data' },
      ],
    },
  });
  const viaBundle = bundleToManifest(
    buildTaskBundle({ runId: RUN_ID, agentsMd: '# Worker', metadata: meta, mirrorPathFor, worktreePathFor }),
  );
  const direct = buildWorkerManifest({
    agentsMd: '# Worker',
    metadata: meta,
    runId: RUN_ID,
    mirrorPathFor,
    worktreePathFor,
  });
  assert.deepEqual(viaBundle, direct);
});

test('buildTaskBundle declares the canonical workspace layout', () => {
  const bundle = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
  });
  assert.deepEqual(bundle.dirs, BUNDLE_DIRS);
  assert.deepEqual(
    bundle.files.map((f) => f.dest),
    ['AGENTS.md', 'context/session-context.md', 'context/task-brief.md', 'context/project-overview.md'],
  );
});

test('buildTaskBundle resolves repos with working branch, worktree and mirror', () => {
  const bundle = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
    worktreePathFor,
  });
  assert.deepEqual(bundle.repos, [
    {
      dest: 'repo',
      ref: 'sample/service',
      baseRef: 'main',
      workingBranch: `agent/TASK-1-${RUN_ID}`,
      worktreePath: '/worktrees/repo',
      mirrorPath: '/mirrors/sample__service.git',
    },
  ]);
});

test('runnerScopeFileFromMetadata writes skills and capabilities into task/scope.json', () => {
  const file = runnerScopeFileFromMetadata(metadata({
    effectiveScope: {
      targetPaths: ['.'],
      capabilities: ['filesystem', 'shell', 'skills'],
      skills: ['repo-orientation'],
    },
  }));
  assert.equal(file.dest, 'task/scope.json');
  const scope = JSON.parse(file.content) as { capabilities: string[]; skills: string[] };
  assert.ok(scope.capabilities.includes('skills'));
  assert.deepEqual(scope.skills, ['repo-orientation']);
});

test('skills are staged under skills/<id>/ with a generated index', () => {
  const bundle = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
    skills: [
      skill('repo-orientation', { 'SKILL.md': '# orientation', 'scripts/x.sh': 'echo 1' }),
    ],
  });
  const manifest = bundleToManifest(bundle);
  assert.equal(manifest.entries['skills/repo-orientation/SKILL.md']?.type, 'inline_file');
  assert.equal(manifest.entries['skills/repo-orientation/scripts/x.sh']?.type, 'inline_file');
  const index = bundle.files.find((f) => f.dest === 'skills/INDEX.md');
  assert.ok(index, 'expected a generated skills index');
  assert.match(index.content, /repo-orientation/);
  assert.match(index.content, /read_skill/);
});

test('a run without skills gets no index file, so the manifest is unchanged', () => {
  const bundle = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
  });
  assert.equal(bundle.skills.length, 0);
  assert.equal(bundle.files.some((f) => f.dest === 'skills/INDEX.md'), false);
});

test('skills are sorted by id so the bundle is deterministic', () => {
  const bundle = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
    skills: [skill('zebra', { 'SKILL.md': 'z' }), skill('alpha', { 'SKILL.md': 'a' })],
  });
  assert.deepEqual(bundle.skills.map((s) => s.id), ['alpha', 'zebra']);
  const again = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
    skills: [skill('alpha', { 'SKILL.md': 'a' }), skill('zebra', { 'SKILL.md': 'z' })],
  });
  assert.deepEqual(bundle, again);
});

test('engine contributions add files but host assets stay out of the manifest', () => {
  const bundle = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
    engineFiles: [{ dest: '.agent/spec.json', content: '{"profileId":"coder"}' }],
    engineAssets: [{ dest: '.agent/pi-runner.js', srcPath: '/host/pi-runner.bundle.cjs' }],
    env: { AGENT_HOME: '/workspace/.agent' },
  });
  const manifest = bundleToManifest(bundle);
  assert.equal(manifest.entries['.agent/spec.json']?.type, 'inline_file');
  // Assets are written through the session after create, as the runtime template does.
  assert.equal(manifest.entries['.agent/pi-runner.js'], undefined);
  assert.deepEqual(bundle.assets, [
    { dest: '.agent/pi-runner.js', srcPath: '/host/pi-runner.bundle.cjs' },
  ]);
  assert.deepEqual(manifest.env, { AGENT_HOME: '/workspace/.agent' });
});

test('workspace policy defaults to rw and passes runAs through', () => {
  const plain = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
  });
  assert.deepEqual(plain.workspace, { writeAccess: 'rw' });
  const owned = buildTaskBundle({
    runId: RUN_ID,
    agentsMd: '# Worker',
    metadata: metadata(),
    mirrorPathFor,
    workspace: { writeAccess: 'ro', runAs: { uid: 1000, gid: 1000 } },
  });
  assert.deepEqual(owned.workspace, { writeAccess: 'ro', runAs: { uid: 1000, gid: 1000 } });
});
