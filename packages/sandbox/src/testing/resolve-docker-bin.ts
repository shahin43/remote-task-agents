import { spawnSync } from 'node:child_process';

/** Resolve a working docker CLI. Shared by Docker-gated tests (not production). */
export function resolveDockerBin(): string {
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

export function dockerDaemonOk(dockerBin: string): boolean {
  return spawnSync(dockerBin, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
}
