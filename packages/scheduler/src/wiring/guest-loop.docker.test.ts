import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { DockerSandboxProvider, DEFAULT_PI_AGENT_IMAGE, GUEST_IMAGE_KIND } from '@remote-sandbox-agents/sandbox';
import type { SandboxContainerInfo } from '@remote-sandbox-agents/sandbox';

import { bundleToManifest } from './task-bundle.js';
import {
  GUEST_LOOP_GREETING_BODY,
  GUEST_LOOP_GREETING_PATH,
  buildGuestLoopFixture,
} from './guest-loop-fixture.js';

function resolveDockerBin(): string {
  const candidates = [
    process.env.DOCKER_BIN,
    process.env.REMOTE_AGENT_DOCKER_BIN,
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    '/opt/homebrew/bin/docker',
    'docker',
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  for (const bin of candidates) {
    if (spawnSync(bin, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0) {
      return bin;
    }
  }
  return candidates[0] ?? 'docker';
}

const DOCKER = resolveDockerBin();
const dockerOk = spawnSync(DOCKER, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const imageOk = dockerOk
  && spawnSync(DOCKER, ['image', 'inspect', DEFAULT_PI_AGENT_IMAGE], { encoding: 'utf8' }).status === 0;
const live = process.env.REMOTE_AGENT_GUEST_E2E_LIVE === '1' && Boolean(process.env.OPENAI_API_KEY);
const skip = !live
  ? 'set REMOTE_AGENT_GUEST_E2E_LIVE=1 and OPENAI_API_KEY'
  : !dockerOk
    ? 'docker not available'
    : !imageOk
      ? `${DEFAULT_PI_AGENT_IMAGE} not built (npm run build:pi-agent-image)`
      : undefined;

test('guest-loop live Pi in Docker completes greeting via TaskBundle mount', { skip }, async () => {
  const fixture = await buildGuestLoopFixture();
  const provider = new DockerSandboxProvider({
    dockerBin: DOCKER,
    image: DEFAULT_PI_AGENT_IMAGE,
    network: true,
  });
  const session = await provider.create({
    manifest: bundleToManifest(fixture.bundle),
    options: { type: 'docker' },
  });
  try {
    const identity = (session.state.container as SandboxContainerInfo | undefined)?.identity;
    assert.ok(identity?.digest?.startsWith('sha256:'), 'guest digest stamped');
    assert.equal(identity?.kind, GUEST_IMAGE_KIND);

    await session.start();

    const baked = await session.exec(['test', '-f', '/opt/worker/pi-runner.bundle.cjs'], { shell: false });
    assert.equal(baked.exitCode, 0, 'baked pi-runner missing from guest image');

    const liveRun = await session.exec(
      ['node', '/opt/worker/pi-runner.bundle.cjs', '/workspace'],
      {
        shell: false,
        env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '' },
        timeoutMs: 300_000,
      },
    );
    assert.equal(liveRun.exitCode, 0, `live pi-runner failed: ${liveRun.stderr}\n${liveRun.stdout}`);
    assert.match(liveRun.stdout, /"status":"completed"/);

    const greeting = await session.exec(['cat', GUEST_LOOP_GREETING_PATH], { shell: false });
    assert.equal(greeting.exitCode, 0, greeting.stderr);
    assert.match(greeting.stdout, /hello-fixture: ping/);
    assert.equal(greeting.stdout.includes(GUEST_LOOP_GREETING_BODY.trim()), true);

    const summary = await session.exec(['cat', 'artifacts/summary.md'], { shell: false });
    assert.equal(summary.exitCode, 0, summary.stderr);
    assert.ok(summary.stdout.trim().length > 0);

    const events = await session.exec(['cat', '.agent/events.jsonl'], { shell: false });
    assert.equal(events.exitCode, 0, events.stderr);
    if (!events.stdout.includes('read_skill')) {
      process.stderr.write('guest-loop live: model did not call read_skill (soft)\n');
    }
  } finally {
    await provider.destroy(session);
    await fixture.cleanup();
  }
});
