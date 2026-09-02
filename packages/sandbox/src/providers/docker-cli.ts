import { spawn } from 'node:child_process';
import type { ExecResult } from '../types.js';

export interface DockerCreateSpec {
  image: string;
  name: string;
  labels: Record<string, string>;
  envAllowlist: Record<string, string>;
  /** Read-only bind mounts (host source visible in the container). */
  roMounts: Array<{ source: string; target: string }>;
  cpus?: string;
  memoryMb?: number;
  pids?: number;
  tmpfs?: string[];
  /** When false, network is disabled (--network none). */
  network: boolean;
}

/** Build argv for `docker create` (hardened, kept alive for exec). */
export function buildCreateArgs(spec: DockerCreateSpec): string[] {
  const args: string[] = ['create', '--name', spec.name];
  // Drop everything by default, then add back ONLY the filesystem-management
  // caps that the host-side workspace alignment needs:
  //   - CHOWN: required for `chown -R <runAs>` inside the container after
  //     `docker cp` lands host-uid files.
  //   - DAC_OVERRIDE: required so root can read/traverse those host-uid
  //     directories during the recursive chown.
  //   - FOWNER: required to chmod inodes the chown step is about to retitle.
  // These do NOT grant network, ptrace, mount, or any privilege that lets the
  // container affect the host. Every other Linux capability remains dropped
  // and `no-new-privileges` blocks setuid binaries from elevating.
  args.push(
    '--cap-drop', 'ALL',
    '--cap-add', 'CHOWN',
    '--cap-add', 'DAC_OVERRIDE',
    '--cap-add', 'FOWNER',
    '--security-opt', 'no-new-privileges',
  );
  if (spec.pids !== undefined) args.push('--pids-limit', String(spec.pids));
  if (spec.cpus !== undefined) args.push('--cpus', spec.cpus);
  if (spec.memoryMb !== undefined) args.push('--memory', `${spec.memoryMb}m`);
  for (const t of spec.tmpfs ?? []) args.push('--tmpfs', t);
  if (!spec.network) args.push('--network', 'none');
  for (const [k, v] of Object.entries(spec.labels)) args.push('--label', `${k}=${v}`);
  for (const [k, v] of Object.entries(spec.envAllowlist)) args.push('--env', `${k}=${v}`);
  for (const m of spec.roMounts) args.push('--mount', `type=bind,source=${m.source},target=${m.target},readonly`);
  args.push(spec.image);
  // Keep the container alive so we can exec into it for the session lifetime.
  args.push('sh', '-lc', 'sleep infinity');
  return args;
}

/** Build argv for a batch `docker exec` (run to completion). */
export function buildExecArgs(container: string, cmd: string[], opts?: { cwd?: string }): string[] {
  const args = ['exec'];
  if (opts?.cwd) args.push('-w', opts.cwd);
  args.push(container, ...cmd);
  return args;
}

/** Build argv for a streaming `docker exec -i` (attached stdio). */
export function buildExecStreamArgs(
  container: string,
  cmd: string,
  cmdArgs: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
): string[] {
  const args = ['exec', '-i'];
  if (opts?.cwd) args.push('-w', opts.cwd);
  for (const [k, v] of Object.entries(opts?.env ?? {})) args.push('--env', `${k}=${v}`);
  args.push(container, cmd, ...cmdArgs);
  return args;
}

/** Run a docker subcommand to completion, returning ExecResult. */
export function runDocker(dockerBin: string, args: string[], opts?: { input?: string; timeoutMs?: number }): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(dockerBin, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`docker ${args[0]} timed out`)); }, opts?.timeoutMs ?? 120_000);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    // Guard stdio streams against EPIPE / ECONNRESET when the docker subprocess
    // exits before we finish writing input or while we're still draining output.
    // The promise still rejects via 'error' or resolves via 'close'.
    child.stdout.on('error', () => undefined);
    child.stderr.on('error', () => undefined);
    if (child.stdin) child.stdin.on('error', () => undefined);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr }); });
    if (opts?.input !== undefined) { child.stdin.write(opts.input); child.stdin.end(); }
  });
}
