import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateArgs, buildExecArgs, buildExecStreamArgs, type DockerCreateSpec } from './docker-cli.js';

const spec: DockerCreateSpec = {
  image: 'remote-sandbox-agents/pi-agent:local',
  name: 'sbx_abc',
  labels: { project: 'remote-sandbox-agents', session_id: 's1' },
  envAllowlist: { OPENAI_API_KEY: 'sk-test', AGENT_HOME: '/workspace/.agent' },
  roMounts: [{ source: '/mirrors/sample__svc.git', target: '/mnt/mirror' }],
  cpus: '2', memoryMb: 4096, pids: 256, tmpfs: ['/tmp'],
  network: true,
};

test('buildCreateArgs includes hardening, labels, env, ro mounts, and keeps container alive', () => {
  const args = buildCreateArgs(spec);
  const s = args.join(' ');
  assert.ok(args[0] === 'create');
  assert.match(s, /--cap-drop ALL/);
  // Re-added filesystem caps required for alignOwnership() chown/chmod.
  assert.match(s, /--cap-add CHOWN/);
  assert.match(s, /--cap-add DAC_OVERRIDE/);
  assert.match(s, /--cap-add FOWNER/);
  assert.match(s, /--security-opt no-new-privileges/);
  assert.match(s, /--pids-limit 256/);
  assert.match(s, /--cpus 2/);
  assert.match(s, /--memory 4096m/);
  assert.match(s, /--tmpfs \/tmp/);
  assert.match(s, /--label project=remote-sandbox-agents/);
  assert.match(s, /--label session_id=s1/);
  assert.match(s, /--env OPENAI_API_KEY=sk-test/);
  assert.match(s, /--env AGENT_HOME=\/workspace\/.agent/);
  assert.match(s, /--mount type=bind,source=\/mirrors\/sample__svc.git,target=\/mnt\/mirror,readonly/);
  assert.match(s, /--name sbx_abc/);
  // keep-alive entrypoint so the container stays up for exec.
  assert.match(s, /remote-sandbox-agents\/pi-agent:local/);
  assert.match(s, /sleep infinity|tail -f/);
});

test('network:false adds --network none', () => {
  const args = buildCreateArgs({ ...spec, network: false });
  assert.match(args.join(' '), /--network none/);
});

test('buildExecArgs is a batch exec with workdir', () => {
  const args = buildExecArgs('sbx_abc', ['git', 'status'], { cwd: '/workspace/repo' });
  assert.deepEqual(args, ['exec', '-w', '/workspace/repo', 'sbx_abc', 'git', 'status']);
});

test('buildExecStreamArgs uses -i and forwards env + workdir', () => {
  const args = buildExecStreamArgs('sbx_abc', 'node', ['runner'], {
    cwd: '/workspace', env: { AGENT_HOME: '/workspace/.agent' },
  });
  assert.deepEqual(args, ['exec', '-i', '-w', '/workspace', '--env', 'AGENT_HOME=/workspace/.agent', 'sbx_abc', 'node', 'runner']);
});
