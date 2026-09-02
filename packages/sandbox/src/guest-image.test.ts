import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PI_AGENT_IMAGE,
  GUEST_IMAGE_LABELS,
  identityFromInspect,
  parseDockerInspect,
} from './guest-image.js';

const imageInspect = [
  {
    Id: 'sha256:aaa111bbb222',
    RepoTags: ['remote-sandbox-agents/pi-agent:local'],
    RepoDigests: [],
    Config: {
      Labels: {
        [GUEST_IMAGE_LABELS.kind]: 'pi-agent-guest',
        [GUEST_IMAGE_LABELS.engine]: 'pi-agent',
        [GUEST_IMAGE_LABELS.contract]: 'runner-protocol-v1',
        [GUEST_IMAGE_LABELS.bundleSha256]: 'deadbeef',
        [GUEST_IMAGE_LABELS.gitSha]: 'abc123def456',
      },
    },
  },
];

const containerInspect = [
  {
    Id: 'sha256:container999',
    Image: 'sha256:aaa111bbb222',
    Config: {
      Image: 'remote-sandbox-agents/pi-agent:local',
      Labels: {
        project: 'remote-sandbox-agents',
        session_id: 's1',
        [GUEST_IMAGE_LABELS.engine]: 'pi-agent',
        [GUEST_IMAGE_LABELS.kind]: 'pi-agent-guest',
        [GUEST_IMAGE_LABELS.bundleSha256]: 'deadbeef',
        [GUEST_IMAGE_LABELS.gitSha]: 'abc123def456',
        [GUEST_IMAGE_LABELS.contract]: 'runner-protocol-v1',
      },
    },
  },
];

test('DEFAULT_PI_AGENT_IMAGE is the local pi-agent guest tag', () => {
  assert.equal(DEFAULT_PI_AGENT_IMAGE, 'remote-sandbox-agents/pi-agent:local');
});

test('parseDockerInspect reads identity from an image inspect payload', () => {
  const identity = parseDockerInspect(JSON.stringify(imageInspect));
  assert.deepEqual(identity, {
    name: 'remote-sandbox-agents/pi-agent:local',
    digest: 'sha256:aaa111bbb222',
    engine: 'pi-agent',
    kind: 'pi-agent-guest',
    bundleSha256: 'deadbeef',
    gitSha: 'abc123def456',
    contract: 'runner-protocol-v1',
  });
});

test('parseDockerInspect reads digest from container Image and name from Config.Image', () => {
  const identity = parseDockerInspect(JSON.stringify(containerInspect));
  assert.equal(identity?.name, 'remote-sandbox-agents/pi-agent:local');
  assert.equal(identity?.digest, 'sha256:aaa111bbb222');
  assert.equal(identity?.engine, 'pi-agent');
  assert.equal(identity?.bundleSha256, 'deadbeef');
});

test('parseDockerInspect prefers RepoDigests when Id is missing', () => {
  const identity = parseDockerInspect(JSON.stringify([{
    RepoTags: ['remote-sandbox-agents/pi-agent:local'],
    RepoDigests: ['remote-sandbox-agents/pi-agent@sha256:ccc'],
    Config: { Labels: {} },
  }]));
  assert.equal(identity?.digest, 'sha256:ccc');
});

test('parseDockerInspect returns null for garbage input', () => {
  assert.equal(parseDockerInspect(''), null);
  assert.equal(parseDockerInspect('not-json'), null);
  assert.equal(parseDockerInspect('[]'), null);
  assert.equal(parseDockerInspect('{}'), null);
});

test('identityFromInspect falls back to the requested name when inspect is unusable', () => {
  assert.deepEqual(identityFromInspect('remote-sandbox-agents/pi-agent:local', ''), {
    name: 'remote-sandbox-agents/pi-agent:local',
    digest: null,
    engine: null,
    kind: null,
    bundleSha256: null,
    gitSha: null,
    contract: null,
  });
});

test('identityFromInspect returns the parsed inspect payload when present', () => {
  const identity = identityFromInspect('ignored:tag', JSON.stringify(imageInspect));
  assert.equal(identity.name, 'remote-sandbox-agents/pi-agent:local');
  assert.equal(identity.digest, 'sha256:aaa111bbb222');
  assert.equal(identity.engine, 'pi-agent');
});
