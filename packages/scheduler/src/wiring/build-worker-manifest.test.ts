import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerManifest, manifestEnvForRuntime } from './build-worker-manifest.js';

const baseInput = {
  agentsMd: '# Coding Worker\nWork in repo/.\n',
  metadata: {
    goal: 'Fix the login timeout',
    orchestratorNotes: 'Focus on token refresh.',
    ticket: { key: 'AGE-14', title: 'Login times out', description: 'Users report 504s', url: 'https://x' },
    repo: { provider: 'local', projectId: 'sample/service', baseBranch: 'main', targetPaths: [] },
    effectiveScope: { targetPaths: ['src/auth'], mounts: [{ kind: 'git', ref: 'sample/service', dest: 'repo', at: 'main' }] },
  },
  runId: 'run-1',
  mirrorPathFor: (repo: string) => `/mirrors/${repo}`,
};

test('builds a manifest with AGENTS.md inline at root', () => {
  const m = buildWorkerManifest(baseInput);
  const agents = m.entries['AGENTS.md'] as { type: string; dest: string; content: string };
  assert.equal(agents.type, 'inline_file');
  assert.equal(agents.dest, 'AGENTS.md');
  assert.match(agents.content, /Coding Worker/);
});

test('defaults the workspace policy to writeAccess: rw so the agent can edit files', () => {
  const m = buildWorkerManifest(baseInput);
  assert.deepEqual(m.workspace, { writeAccess: 'rw' });
});

test('honors an explicit workspace policy (ro audit, runAs alignment)', () => {
  const m = buildWorkerManifest({
    ...baseInput,
    workspace: { writeAccess: 'ro', runAs: { uid: 1000, gid: 1000 } },
  });
  assert.deepEqual(m.workspace, { writeAccess: 'ro', runAs: { uid: 1000, gid: 1000 } });
});

test('writes session context as an inline file under context/', () => {
  const m = buildWorkerManifest(baseInput);
  const ctx = m.entries['context/session-context.md'] as { type: string; content: string };
  assert.equal(ctx.type, 'inline_file');
  assert.match(ctx.content, /Fix the login timeout/);
  assert.match(ctx.content, /AGE-14/);
  assert.match(ctx.content, /Focus on token refresh/);
});

test('legacy path adds git_mount from mirror when worktreePathFor is absent', () => {
  const m = buildWorkerManifest(baseInput);
  const repo = m.entries['repo'] as { type: string; provider: string; repo: string; baseRef: string; dest: string; workingBranch: string };
  assert.equal(repo.type, 'git_mount');
  assert.equal(repo.repo, '/mirrors/sample/service');
  assert.equal(repo.baseRef, 'main');
  assert.equal(repo.dest, 'repo');
  assert.equal(repo.workingBranch, 'agent/AGE-14-run-1');
});

test('staged worktrees use local_dir + capture-only git_mount (OpenAI LocalDir pattern)', () => {
  const m = buildWorkerManifest({
    ...baseInput,
    worktreePathFor: (dest) => `/worktrees/run-1/${dest}`,
  });
  const repo = m.entries['repo'] as { type: string; src: string; dest: string };
  const capture = m.entries['repo__git_capture'] as { type: string; captureOnly: boolean; dest: string };
  assert.equal(repo.type, 'local_dir');
  assert.equal(repo.src, '/worktrees/run-1/repo');
  assert.equal(capture.type, 'git_mount');
  assert.equal(capture.captureOnly, true);
  assert.equal(capture.dest, 'repo');
});

test('falls back to repo metadata when effectiveScope has no mounts', () => {
  const input = { ...baseInput, metadata: { ...baseInput.metadata, effectiveScope: { targetPaths: [], mounts: [] } } };
  const m = buildWorkerManifest(input);
  const repo = m.entries['repo'] as { type: string; repo: string; workingBranch: string };
  assert.equal(repo.type, 'git_mount');
  assert.equal(repo.repo, '/mirrors/sample/service');
  assert.equal(repo.workingBranch, 'agent/AGE-14-run-1');
});

test('omits the git mount entirely when there is no repo info', () => {
  const input = { ...baseInput, metadata: { goal: 'just think', orchestratorNotes: undefined } as Record<string, unknown> };
  const m = buildWorkerManifest(input);
  assert.equal(m.entries['repo'], undefined);
  assert.ok(m.entries['AGENTS.md'], 'AGENTS.md still present');
});

test('manifestEnvForRuntime: docker carries AGENT_HOME and never the API key', () => {
  const env = manifestEnvForRuntime('sandbox-docker');
  assert.equal(env.AGENT_HOME, '/workspace/.agent');
  assert.ok(!('OPENAI_API_KEY' in env), 'the API key must not enter the container-wide env');
  assert.ok(!('OPENAI_API_KEY' in env));
});

test('manifestEnvForRuntime: non-docker runtimes carry no container env', () => {
  assert.deepEqual(manifestEnvForRuntime('sandbox-unix-local'), {});
  assert.deepEqual(manifestEnvForRuntime('local'), {});
});

test('mounts all git repos from effectiveScope', () => {
  const input = {
    ...baseInput,
    metadata: {
      ...baseInput.metadata,
      effectiveScope: {
        targetPaths: [],
        mounts: [
          { kind: 'git', ref: 'sample/service', dest: 'repo', at: 'main' },
          { kind: 'git', ref: 'sample/other', dest: 'other', at: 'main' },
        ],
      },
    },
  };
  const m = buildWorkerManifest(input);
  const repo = m.entries['repo'] as { type: string; repo: string };
  const other = m.entries['other'] as { type: string; repo: string };
  assert.equal(repo.type, 'git_mount');
  assert.equal(repo.repo, '/mirrors/sample/service');
  assert.equal(other.type, 'git_mount');
  assert.equal(other.repo, '/mirrors/sample/other');
});
