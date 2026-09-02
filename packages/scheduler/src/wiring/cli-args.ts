import path from 'node:path';

export type ServiceRole = 'api' | 'control' | 'worker' | 'reconciler';

export interface CliArgs {
  role: ServiceRole;
  /**
   * Local-dev convenience: when set with `--role api`, the API process also
   * spawns the embedded worker drain. Production deployments must run a
   * separate `--role worker` process instead.
   */
  withWorker: boolean;
  workspaceRoot: string;
  runsRoot: string;
  pollIntervalMs: number;
  workerLeaseMinutes: number;
  workerId: string;
  /** Identity for the control process (logs, metrics). */
  controlId: string;
  /** Worker concurrency (parsed; sequential drain is the current default). */
  workerConcurrency: number;
  once: boolean;
  apiPort: number;
  apiToken?: string;
  dryRun: boolean;
  repoOverrideRoot?: string;
  /** Optional internal health port for control/worker/reconciler. */
  healthPort?: number;
}

export interface ParseArgsOptions {
  /** Defaults to process.env. Overridable for unit tests. */
  env?: Record<string, string | undefined>;
  /** Defaults to process.cwd() relative-resolution. Overridable for tests. */
  resolvePath?: (p: string) => string;
}

const DEFAULT_API_PORT = 8787;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_LEASE_MINUTES = 45;
const DEFAULT_WORKER_CONCURRENCY = 1;

/**
 * Parse the scheduler CLI. Throws an Error on invalid role/flag
 * combinations so misconfigurations are caught at startup rather than
 * surprising the operator after the process has half-booted (e.g. a
 * production `--role api` accidentally also running the worker drain).
 */
export function parseArgs(argv: string[], options: ParseArgsOptions = {}): CliArgs {
  const env = options.env ?? process.env;
  const resolvePath = options.resolvePath ?? path.resolve;

  const defaults: CliArgs = {
    role: coerceRole(env.REMOTE_AGENT_ROLE ?? env.SERVICE_ROLE),
    withWorker: env.REMOTE_AGENT_WITH_WORKER === 'true',
    workspaceRoot: 'runs/workspaces',
    runsRoot: 'runs/state',
    pollIntervalMs: numberFromEnv(env, 'REMOTE_AGENT_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
    workerLeaseMinutes: numberFromEnv(env, 'REMOTE_AGENT_WORKER_LEASE_MINUTES', DEFAULT_LEASE_MINUTES),
    workerId: env.WORKER_ID ?? env.HOSTNAME ?? 'local-worker',
    controlId: env.CONTROL_ID ?? env.HOSTNAME ?? 'local-control',
    workerConcurrency: numberFromEnv(env, 'REMOTE_AGENT_WORKER_CONCURRENCY', DEFAULT_WORKER_CONCURRENCY),
    once: env.REMOTE_AGENT_ONCE === 'true',
    apiPort: numberFromEnv(env, 'REMOTE_AGENT_API_PORT', DEFAULT_API_PORT),
    apiToken: env.REMOTE_AGENT_API_TOKEN,
    dryRun: env.REMOTE_AGENT_DRY_RUN === 'true',
    repoOverrideRoot: undefined,
    healthPort: numberFromEnv(env, 'REMOTE_AGENT_HEALTH_PORT', 0) || undefined,
  };

  let explicitConcurrency = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--role':
        if (!next) throw new Error('--role requires a value (api|control|worker|reconciler)');
        defaults.role = coerceExplicitRole(next);
        i += 1;
        break;
      case '--with-worker':
        defaults.withWorker = true;
        break;
      case '--repo':
        if (!next) throw new Error('--repo requires a path');
        defaults.repoOverrideRoot = resolvePath(next);
        i += 1;
        break;
      case '--workspace-root':
        if (!next) throw new Error('--workspace-root requires a path');
        defaults.workspaceRoot = next;
        i += 1;
        break;
      case '--runs-root':
        if (!next) throw new Error('--runs-root requires a path');
        defaults.runsRoot = next;
        i += 1;
        break;
      case '--live':
        defaults.dryRun = false;
        break;
      case '--dry-run':
        defaults.dryRun = true;
        break;
      case '--poll-interval-ms':
        if (!next) throw new Error('--poll-interval-ms requires a value');
        defaults.pollIntervalMs = positiveNumber(next, defaults.pollIntervalMs);
        i += 1;
        break;
      case '--worker-lease-minutes':
        if (!next) throw new Error('--worker-lease-minutes requires a value');
        defaults.workerLeaseMinutes = positiveNumber(next, defaults.workerLeaseMinutes);
        i += 1;
        break;
      case '--worker-concurrency':
        if (!next) throw new Error('--worker-concurrency requires a value');
        defaults.workerConcurrency = positiveNumber(next, defaults.workerConcurrency);
        explicitConcurrency = true;
        i += 1;
        break;
      case '--worker-id':
        if (!next) throw new Error('--worker-id requires a value');
        defaults.workerId = next;
        i += 1;
        break;
      case '--control-id':
        if (!next) throw new Error('--control-id requires a value');
        defaults.controlId = next;
        i += 1;
        break;
      case '--api-port':
        if (!next) throw new Error('--api-port requires a value');
        defaults.apiPort = positiveNumber(next, defaults.apiPort);
        i += 1;
        break;
      case '--api-token':
        if (!next) throw new Error('--api-token requires a value');
        defaults.apiToken = next;
        i += 1;
        break;
      case '--health-port':
        if (!next) throw new Error('--health-port requires a value');
        defaults.healthPort = positiveNumber(next, 0);
        i += 1;
        break;
      case '--once':
        defaults.once = true;
        break;
      default:
        if (arg && arg.startsWith('--')) {
          throw new Error(`unknown CLI flag: ${arg}`);
        }
    }
  }

  validateCombinations(defaults, { explicitConcurrency });

  return {
    ...defaults,
    workspaceRoot: resolvePath(defaults.workspaceRoot),
    runsRoot: resolvePath(defaults.runsRoot),
  };
}

function validateCombinations(args: CliArgs, ctx: { explicitConcurrency: boolean }): void {
  if (args.withWorker && args.role !== 'api') {
    throw new Error(
      `--with-worker is only valid with --role api (got --role ${args.role}); ` +
      `use --role worker for a standalone worker process.`,
    );
  }
  if (args.role !== 'worker' && ctx.explicitConcurrency && !args.withWorker) {
    throw new Error(
      `--worker-concurrency is only valid with --role worker or --role api --with-worker ` +
      `(got --role ${args.role}).`,
    );
  }
}

function coerceRole(value: string | undefined): ServiceRole {
  if (value === 'worker' || value === 'api' || value === 'control' || value === 'reconciler') return value;
  return 'api';
}

function coerceExplicitRole(value: string): ServiceRole {
  if (value === 'worker' || value === 'api' || value === 'control' || value === 'reconciler') return value;
  throw new Error(`invalid --role value: "${value}" (expected api|control|worker|reconciler)`);
}

function numberFromEnv(env: Record<string, string | undefined>, name: string, fallback: number): number {
  return positiveNumber(env[name], fallback);
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
