import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildLocalTools } from './local-tools.js';

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'local-tools-'));
}

test('buildLocalTools exposes filesystem + shell tools and filters by scope', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['filesystem', 'shell'], skills: [] });
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['read_file', 'shell', 'write_file']);
  assert.ok(!names.includes('apply_patch'));
});

test('write_file then read_file round-trips within the root', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['filesystem'], skills: [] });
  const write = tools.find((t) => t.name === 'write_file')!;
  const read = tools.find((t) => t.name === 'read_file')!;
  const w = await write.invoke({ path: 'sub/a.txt', content: 'hello' });
  assert.equal(w.success, true);
  const r = await read.invoke({ path: 'sub/a.txt' });
  assert.equal(r.success, true);
  assert.match(r.output, /hello/);
});

test('write_file rejects paths that escape the root', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['filesystem'], skills: [] });
  const write = tools.find((t) => t.name === 'write_file')!;
  const res = await write.invoke({ path: '../escape.txt', content: 'no' });
  assert.equal(res.success, false);
  assert.match(res.output, /escapes workspace root/);
});

test('shell runs a command in the root and returns output', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['shell'], skills: [] });
  const shell = tools.find((t) => t.name === 'shell')!;
  const res = await shell.invoke({ command: 'echo hi-there' });
  assert.equal(res.success, true);
  assert.match(res.output, /hi-there/);
});

// Regression for the 2026-06-29 path-doubling bug: when the agent's prompt
// describes paths relative to the *workspace* root (e.g. "repo/README.md"),
// `read_file` must resolve them against the workspace root — never against
// `<root>/repo`. The pi-runner now passes the workspace root to file tools
// and a separate `execCwd: <root>/repo` to shell tools, so the symptoms
// "/workspace/repo/repo/README.md ENOENT" cannot recur.
test('read_file does not double the `repo/` prefix when paths are workspace-relative', async () => {
  const root = await tmpRoot();
  await fs.mkdir(path.join(root, 'repo'), { recursive: true });
  await fs.writeFile(path.join(root, 'repo', 'README.md'), 'project readme');
  // Mirrors the pi-runner-entry wiring: workspace root + execCwd=repoDir.
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['filesystem'], skills: [] }, {
    execCwd: path.join(root, 'repo'),
  });
  const read = tools.find((t) => t.name === 'read_file')!;
  const res = await read.invoke({ path: 'repo/README.md' });
  assert.equal(res.success, true, `expected success, got: ${res.output}`);
  assert.match(res.output, /project readme/);
});

test('shell uses execCwd (the repo working tree) so `git`/`pwd` resolve there', async () => {
  const root = await tmpRoot();
  const repoDir = path.join(root, 'repo');
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, 'marker.txt'), 'inside repo');
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['shell'], skills: [] }, {
    execCwd: repoDir,
  });
  const shell = tools.find((t) => t.name === 'shell')!;
  const res = await shell.invoke({ command: 'pwd && ls' });
  assert.equal(res.success, true);
  assert.match(res.output, /\/repo\b/, 'pwd should report the repo subdir');
  assert.match(res.output, /marker\.txt/, 'ls should see files inside the repo');
});

test('handoff sidecar lands at <root>/.agent/handoff.json (workspace root, not repo subdir)', async () => {
  // The harness collector reads `.agent/handoff.json` against the workspace
  // root via SandboxSession.read, so this is the canonical location. Tools
  // were briefly rooted at <root>/repo by mistake, which silently dropped
  // the sidecar inside the repo and broke handoff propagation end-to-end.
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['handoff'], skills: [] }, {
    execCwd: path.join(root, 'repo'),
  });
  const handoff = tools.find((t) => t.name === 'handoff')!;
  const res = await handoff.invoke({ targetKind: 'agent', targetId: 'agent-reviewer', status: 'review' });
  assert.equal(res.success, true);
  // MUST exist at workspace-root .agent
  await fs.access(path.join(root, '.agent', 'handoff.json'));
  // MUST NOT exist at repo .agent (the path-doubling failure mode)
  await assert.rejects(fs.access(path.join(root, 'repo', '.agent', 'handoff.json')));
});

// ----- handoff tool -----

test('handoff tool is omitted when the capability is not granted', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['filesystem'], skills: [] });
  assert.ok(!tools.some((t) => t.name === 'handoff'), 'handoff must be capability-gated');
});

test('handoff tool writes .agent/handoff.json with the canonical shape', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['handoff'], skills: [] });
  const handoff = tools.find((t) => t.name === 'handoff')!;
  const res = await handoff.invoke({
    targetKind: 'agent',
    targetId: 'agent-reviewer',
    status: 'review',
    message: 'ready for review',
  });
  assert.equal(res.success, true);
  const raw = await fs.readFile(path.join(root, '.agent', 'handoff.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed, {
    targetKind: 'agent',
    targetId: 'agent-reviewer',
    status: 'review',
    message: 'ready for review',
  });
});

test('handoff tool rejects unknown targetKind without writing the file', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['handoff'], skills: [] });
  const handoff = tools.find((t) => t.name === 'handoff')!;
  const res = await handoff.invoke({ targetKind: 'team', targetId: 'whatever' });
  assert.equal(res.success, false);
  await assert.rejects(fs.access(path.join(root, '.agent', 'handoff.json')));
});

test('handoff tool rejects missing targetId without writing the file', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['handoff'], skills: [] });
  const handoff = tools.find((t) => t.name === 'handoff')!;
  const res = await handoff.invoke({ targetKind: 'agent' });
  assert.equal(res.success, false);
  await assert.rejects(fs.access(path.join(root, '.agent', 'handoff.json')));
});

test('handoff tool is idempotent: second invoke overwrites without leaking state', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['handoff'], skills: [] });
  const handoff = tools.find((t) => t.name === 'handoff')!;
  await handoff.invoke({ targetKind: 'agent', targetId: 'agent-reviewer' });
  await handoff.invoke({
    targetKind: 'user',
    targetId: 'user-dev',
    status: 'done',
  });
  const raw = await fs.readFile(path.join(root, '.agent', 'handoff.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed, { targetKind: 'user', targetId: 'user-dev', status: 'done' });
});

test('handoff tool rejects unknown status (defends the harness applier)', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['handoff'], skills: [] });
  const handoff = tools.find((t) => t.name === 'handoff')!;
  const res = await handoff.invoke({
    targetKind: 'agent',
    targetId: 'agent-reviewer',
    status: 'in_progress',
  });
  assert.equal(res.success, false);
});

// ----- request_mr tool -----

test('request_mr tool is omitted when capability is not granted', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['filesystem'], skills: [] });
  assert.ok(!tools.some((t) => t.name === 'request_mr'));
});

test('request_mr writes .agent/mr-request.json at workspace root', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, { targetPaths: ['.'], capabilities: ['request_mr'], skills: [] });
  const requestMr = tools.find((t) => t.name === 'request_mr')!;
  const res = await requestMr.invoke({
    title: 'Fix auth token refresh',
    summary: 'Updated refresh handling and added tests.',
    targetBranch: 'main',
    draft: true,
  });
  assert.equal(res.success, true);
  const raw = await fs.readFile(path.join(root, '.agent', 'mr-request.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.title, 'Fix auth token refresh');
  assert.equal(parsed.draft, true);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'token'), false);
  assert.equal(JSON.stringify(parsed).includes('glpat-'), false);
  assert.equal(JSON.stringify(parsed).includes('PRIVATE-TOKEN'), false);
});

async function skillRoot(id: string, files: Record<string, string>): Promise<string> {
  const root = await tmpRoot();
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, 'skills', id, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return root;
}

test('read_skill is absent without the skills capability', async () => {
  const root = await skillRoot('repo-orientation', { 'SKILL.md': '# orientation' });
  const tools = buildLocalTools(root, {
    targetPaths: ['.'],
    capabilities: ['filesystem'],
    skills: ['repo-orientation'],
  });
  assert.equal(tools.some((t) => t.name === 'read_skill'), false);
});

test('read_skill is absent when the run resolved no skills', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, {
    targetPaths: ['.'],
    capabilities: ['filesystem', 'skills'],
    skills: [],
  });
  assert.equal(tools.some((t) => t.name === 'read_skill'), false);
});

test('read_skill returns the SKILL.md body and lists payload files', async () => {
  const root = await skillRoot('repo-orientation', {
    'SKILL.md': '# Repo orientation\n\nRead AGENTS.md first.\n',
    'scripts/check.sh': 'echo hi\n',
    'skill.manifest.json': '{"version":"1.0.0"}',
  });
  const tools = buildLocalTools(root, {
    targetPaths: ['.'],
    capabilities: ['filesystem', 'skills'],
    skills: ['repo-orientation'],
  });
  const readSkill = tools.find((t) => t.name === 'read_skill')!;
  const res = await readSkill.invoke({ id: 'repo-orientation' });
  assert.equal(res.success, true);
  assert.match(res.output, /Read AGENTS\.md first/);
  assert.match(res.output, /skills\/repo-orientation\/scripts\/check\.sh/);
  // The manifest is catalog metadata, not something the agent needs to read.
  assert.equal(/skill\.manifest\.json/.test(res.output), false);
});

test('read_skill refuses a skill that was not resolved for this run', async () => {
  const root = await skillRoot('allowed', { 'SKILL.md': '# allowed' });
  await fs.mkdir(path.join(root, 'skills', 'secret'), { recursive: true });
  await fs.writeFile(path.join(root, 'skills', 'secret', 'SKILL.md'), '# secret', 'utf8');
  const tools = buildLocalTools(root, {
    targetPaths: ['.'],
    capabilities: ['skills'],
    skills: ['allowed'],
  });
  const readSkill = tools.find((t) => t.name === 'read_skill')!;
  const res = await readSkill.invoke({ id: 'secret' });
  assert.equal(res.success, false);
  assert.match(res.output, /not available to this run/);
  assert.match(res.output, /Available: allowed/);
});

test('read_skill refuses a traversal id even before touching the filesystem', async () => {
  const root = await skillRoot('allowed', { 'SKILL.md': '# allowed' });
  const tools = buildLocalTools(root, {
    targetPaths: ['.'],
    capabilities: ['skills'],
    skills: ['allowed'],
  });
  const readSkill = tools.find((t) => t.name === 'read_skill')!;
  const res = await readSkill.invoke({ id: '../../etc' });
  assert.equal(res.success, false);
  assert.match(res.output, /not available to this run/);
});

test('read_skill reports a missing SKILL.md instead of throwing', async () => {
  const root = await tmpRoot();
  const tools = buildLocalTools(root, {
    targetPaths: ['.'],
    capabilities: ['skills'],
    skills: ['ghost'],
  });
  const readSkill = tools.find((t) => t.name === 'read_skill')!;
  const res = await readSkill.invoke({ id: 'ghost' });
  assert.equal(res.success, false);
  assert.match(res.output, /read_skill failed/);
});
