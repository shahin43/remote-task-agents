import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ReapOrphanContainersOptions {
  dockerBin: string;
  /** Label filter selecting this project's sandbox containers. */
  label?: string;
  /** Injectable exec for tests. Resolves with stdout. */
  exec?: (bin: string, args: string[]) => Promise<{ stdout: string }>;
}

/**
 * Remove sandbox containers left behind by a previous crashed run (SIGKILL
 * skips the scheduler's finally-destroy). Containers are matched by the label
 * the Docker provider stamps at create. Best-effort: any failure (docker not
 * installed, daemon down) is reported as zero reaped, never thrown.
 *
 * Note: this assumes one orchestrator per host. A second live instance on the
 * same daemon would have its in-flight containers reaped at startup.
 */
export async function reapOrphanContainers(opts: ReapOrphanContainersOptions): Promise<string[]> {
  const label = opts.label ?? 'project=remote-sandbox-agents';
  const exec = opts.exec ?? (async (bin: string, args: string[]) => execFileAsync(bin, args));
  try {
    const { stdout } = await exec(opts.dockerBin, ['ps', '-aq', '--filter', `label=${label}`]);
    const ids = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    if (ids.length === 0) return [];
    await exec(opts.dockerBin, ['rm', '-f', ...ids]);
    return ids;
  } catch {
    return [];
  }
}
