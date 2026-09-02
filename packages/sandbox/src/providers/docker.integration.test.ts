import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createManifest } from '../manifest.js';
import { DockerSandboxProvider } from './docker.js';
import type { SandboxContainerInfo } from '../events.js';
import { dockerDaemonOk, resolveDockerBin } from '../testing/resolve-docker-bin.js';

const DOCKER = resolveDockerBin();
const skip = dockerDaemonOk(DOCKER) ? undefined : 'docker not available';

test('docker session: create, exec, spawnStream echo, write/read, persistWorkspace, destroy', { skip }, async () => {
  const provider = new DockerSandboxProvider({ dockerBin: DOCKER, image: 'alpine:3.20' });
  const manifest = createManifest({
    entries: { 'hello.txt': { type: 'inline_file', dest: 'hello.txt', content: 'hi\n' } },
    env: {},
  });
  const session = await provider.create({ manifest, options: { type: 'docker' } });
  try {
    const container = session.state.container as SandboxContainerInfo | undefined;
    assert.ok(container?.identity?.digest?.startsWith('sha256:'), 'create stamps image digest from docker inspect');
    assert.match(container?.identity?.name ?? '', /alpine/);
    await session.start();

    // inline_file materialized inside the container
    const cat = await session.exec(['cat', 'hello.txt'], { shell: false });
    assert.equal(cat.exitCode, 0);
    assert.match(cat.stdout, /hi/);

    // batch exec
    const echo = await session.exec(['echo', 'batch-ok'], { shell: false });
    assert.match(echo.stdout, /batch-ok/);

    // streaming: run `cat` and round-trip a line
    const h = session.spawnStream!('cat', [], {});
    let out = '';
    h.stdout.on('data', (d) => (out += d.toString()));
    h.stdin.write('stream-ok\n');
    h.stdin.end();
    await h.exitCode;
    assert.match(out, /stream-ok/);

    // write/read
    await session.write('w.txt', 'written\n');
    const r = await session.read('w.txt');
    let rc = '';
    for await (const chunk of r) rc += chunk.toString();
    assert.match(rc, /written/);

    // persistWorkspace yields a non-empty tar
    const tar = await session.persistWorkspace();
    let bytes = 0;
    for await (const chunk of tar) bytes += (chunk as Buffer).length;
    assert.ok(bytes > 0, 'workspace tar is non-empty');
  } finally {
    await provider.destroy(session);
  }
});

/**
 * Reproduces a host-staged `local_dir` copied in via `docker cp` that ends up
 * via `docker cp` and ends up owned by the host user (uid 501 on macOS),
 * while the agent runs as the image's default `node` user (uid 1000). Without
 * alignOwnership() the container's runtime user cannot write into the tree.
 */
test('docker session: alignOwnership() lets the container user write into a host-staged local_dir', { skip }, async () => {
  const provider = new DockerSandboxProvider({ dockerBin: DOCKER, image: 'node:22-bookworm-slim' });
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-stage-'));
  await fs.writeFile(path.join(stage, 'README.md'), 'origin\n');
  try {
    const manifest = createManifest({
      entries: {
        repo: { type: 'local_dir', src: stage, dest: 'repo' },
      },
      env: {},
      // No explicit runAs — the provider resolves it from `docker exec id` so
      // we exercise the auto-detection path (mirrors the production wiring).
      workspace: { writeAccess: 'rw' },
    });
    const session = await provider.create({ manifest, options: { type: 'docker' } });
    try {
      await session.start();
      // After start() runs alignOwnership(), the container's default user must
      // be able to create a file inside the host-staged repo dir.
      const write = await session.exec(['sh', '-lc', 'echo agent-write > repo/touched.txt'], { shell: false });
      assert.equal(write.exitCode, 0, `write failed: ${write.stderr}`);
      const read = await session.exec(['cat', 'repo/touched.txt'], { shell: false });
      assert.match(read.stdout, /agent-write/);
    } finally {
      await provider.destroy(session);
    }
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
});

test('docker session: writeAccess "ro" blocks writes for the non-root runtime user', { skip }, async () => {
  // The `node:22-bookworm-slim` image ships with a non-root `node` user (uid
  // 1000). We chown the tree to that user and the chmod step strips all
  // write bits — so a `docker exec -u 1000` write must fail. (If we ran as
  // root, CAP_DAC_OVERRIDE — which we keep for the chown phase — would let
  // root ignore chmod bits. Production worker images always run agents as a
  // non-root user, which is what this test models.)
  const provider = new DockerSandboxProvider({ dockerBin: DOCKER, image: 'node:22-bookworm-slim' });
  const manifest = createManifest({
    entries: { 'README.md': { type: 'inline_file', dest: 'README.md', content: 'hi\n' } },
    env: {},
    workspace: { writeAccess: 'ro', runAs: { uid: 1000, gid: 1000 } },
  });
  const session = await provider.create({ manifest, options: { type: 'docker' } });
  try {
    await session.start();
    // The `id` exec defaults to root; explicitly target uid 1000 to model the
    // in-container agent process.
    const blocked = await runDockerExec(DOCKER, session.state.containerId as string, 1000, 'echo nope > /workspace/README.md');
    assert.notEqual(blocked, 0, 'write should be rejected for the non-root agent user under writeAccess: ro');
  } finally {
    await provider.destroy(session);
  }
});

async function runDockerExec(dockerBin: string, container: string, uid: number, shellCmd: string): Promise<number> {
  const { spawn } = await import('node:child_process');
  return await new Promise<number>((resolve) => {
    const child = spawn(dockerBin, ['exec', '-u', String(uid), container, 'sh', '-lc', shellCmd], { stdio: 'pipe' });
    child.on('exit', (code) => resolve(code ?? -1));
    child.on('error', () => resolve(-1));
  });
}
