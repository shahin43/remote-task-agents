import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractWorkspaceSeed, packWorkspaceSeed } from './workspace-seed.js';

async function tarList(tarPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tf', tarPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.split('\n').map((l) => l.replace(/^\.\//, '')).filter(Boolean));
      else reject(new Error(err || `tar -tf exit ${code}`));
    });
  });
}

test('workspace seed tar round-trips /workspace layout (repo, skills, scope)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-pack-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(path.join(workspace, 'repo'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'skills', 'hello'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'task'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'repo', 'README.md'), 'hi\n');
  await fs.writeFile(path.join(workspace, 'task', 'scope.json'), '{"capabilities":["handoff"]}\n');
  await fs.writeFile(path.join(workspace, 'skills', 'hello', 'SKILL.md'), '# hello\n');

  const tar = path.join(root, 'workspace-seed.tar');
  await packWorkspaceSeed(workspace, tar);

  const out = path.join(root, 'out');
  await extractWorkspaceSeed(tar, out);
  assert.equal(await fs.readFile(path.join(out, 'repo', 'README.md'), 'utf8'), 'hi\n');
  assert.equal(await fs.readFile(path.join(out, 'task', 'scope.json'), 'utf8'), '{"capabilities":["handoff"]}\n');
  assert.equal(await fs.readFile(path.join(out, 'skills', 'hello', 'SKILL.md'), 'utf8'), '# hello\n');
});

test('packWorkspaceSeed omits AppleDouble and Finder junk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-apple-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(path.join(workspace, 'repo'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'repo', 'README.md'), 'ok\n');
  await fs.writeFile(path.join(workspace, '._repo'), 'appledouble');
  await fs.writeFile(path.join(workspace, '.DS_Store'), 'finder');
  await fs.mkdir(path.join(workspace, '__MACOSX'), { recursive: true });
  await fs.writeFile(path.join(workspace, '__MACOSX', 'junk'), 'x');

  const tar = path.join(root, 'workspace-seed.tar');
  await packWorkspaceSeed(workspace, tar);
  const members = await tarList(tar);
  assert.ok(members.some((m) => m === 'repo/README.md' || m === 'repo/README.md/'));
  assert.equal(members.some((m) => m === '._repo' || m.endsWith('/._repo')), false);
  assert.equal(members.some((m) => m.includes('.DS_Store')), false);
  assert.equal(members.some((m) => m.includes('__MACOSX')), false);
});

test('packWorkspaceSeed does not nest dest tar when writing inside the workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-nested-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(path.join(workspace, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'repo'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'repo', 'README.md'), 'ok\n');
  const dest = path.join(workspace, 'artifacts', 'workspace.tar');
  await packWorkspaceSeed(workspace, dest);
  const members = await tarList(dest);
  assert.equal(members.some((m) => m === 'artifacts/workspace.tar' || m.endsWith('workspace.tar')), false);
  assert.ok(members.some((m) => m.includes('repo/README.md')));
});

test('extractWorkspaceSeed keeps payload when archive contains AppleDouble members', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-extract-'));
  const src = path.join(root, 'src');
  await fs.mkdir(path.join(src, 'repo'), { recursive: true });
  await fs.writeFile(path.join(src, 'repo', 'README.md'), 'payload\n');
  // Real AppleDouble sidecar for a directory — BSD tar treats this as a
  // resource fork and exits "Truncated input file" unless we skip it.
  const sidecar = Buffer.alloc(163);
  sidecar.writeUInt32BE(0x00051607, 0);
  sidecar.writeUInt32BE(0x00020000, 4);
  await fs.writeFile(path.join(src, '._repo'), sidecar);
  const dirty = path.join(root, 'dirty.tar');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-cf', dirty, '-C', src, '.'], {
      stdio: 'ignore',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
  });
  const out = path.join(root, 'out');
  await extractWorkspaceSeed(dirty, out);
  assert.equal(await fs.readFile(path.join(out, 'repo', 'README.md'), 'utf8'), 'payload\n');
});

test('extractWorkspaceSeed survives a real guest GNU tar with directory AppleDouble', async (t) => {
  const fixture = '/tmp/guest-fail.tar';
  try {
    await fs.access(fixture);
  } catch {
    t.skip('guest-fail.tar not downloaded in this environment');
    return;
  }
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-retool-'));
  await extractWorkspaceSeed(fixture, out);
  const readme = await fs.readFile(path.join(out, 'repo', 'README.md'), 'utf8');
  assert.match(readme, /retool|Remote agent|Retool/i);
  const sidecar = await fs.stat(path.join(out, '._repo')).then(() => true).catch(() => false);
  assert.equal(sidecar, false);
});
