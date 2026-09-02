#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { createBoardApiHandler } from './api/board-api.js';
import { wireWorkerRuntime, type WorkerRuntime } from './wiring/worker-runtime.js';
import { wireApiRuntime } from './runtime/api-runtime.js';
import { wireControlRuntime } from './runtime/control-runtime.js';
import { wireReconcilerRuntime } from './runtime/reconciler-runtime.js';
import { startHealthServer } from './runtime/health.js';
import { parseArgs, type CliArgs } from './wiring/cli-args.js';
import { startControlLoop, type ControlLoopHandle } from './wiring/control-loop.js';
import { startEmbeddedWorkerDrain, type EmbeddedWorkerDrainHandle } from './wiring/embedded-worker-drain.js';
import {
  startSnapshotRetentionSweep,
  type SnapshotSweepHandle,
  type SnapshotSweepPolicy,
} from './wiring/snapshot-retention.js';

/**
 * Long-running roles (`--role api`, `--role control`, `--role worker`) must
 * survive transient stream errors and unhandled rejections. EPIPE on a docker
 * stdio pipe, a closed HTTP response socket, or a dropped pg connection
 * should not bring the whole service down — the per-session try/catch
 * already records the failure into `session_events` and surfaces it via
 * `worker_end` to the board UI's Output tab.
 */
function installProcessSafetyNet(): void {
  if ((process as unknown as { __remoteSandboxAgentsSafetyNet?: boolean }).__remoteSandboxAgentsSafetyNet) return;
  (process as unknown as { __remoteSandboxAgentsSafetyNet?: boolean }).__remoteSandboxAgentsSafetyNet = true;
  process.on('uncaughtException', (err) => {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
    process.stderr.write(`scheduler.uncaught_exception ${msg}${stack}\n`);
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const stack = err.stack ? `\n${err.stack}` : '';
    process.stderr.write(`scheduler.unhandled_rejection ${err.name}: ${err.message}${stack}\n`);
  });
}

async function main(): Promise<void> {
  installProcessSafetyNet();
  const args = parseArgs(process.argv.slice(2));

  switch (args.role) {
    case 'worker':
      await runWorkerLoop(args);
      return;
    case 'control':
      await runControlProcess(args);
      return;
    case 'api':
      await runApiServer(args);
      return;
    case 'reconciler':
      await runReconcilerProcess(args);
      return;
  }
}

function workerRuntimePaths(args: CliArgs): {
  workspaceRoot: string;
  runsRoot: string;
  workerAssetsRoot: string;
  piRunnerBundlePath: string;
  repoOverrideRoot?: string;
} {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return {
    workspaceRoot: args.workspaceRoot,
    runsRoot: args.runsRoot,
    workerAssetsRoot: path.resolve(thisDir, '../../worker/dist/assets'),
    piRunnerBundlePath: path.resolve(thisDir, '../../agent-engines/dist/pi-runner.bundle.cjs'),
    repoOverrideRoot: args.repoOverrideRoot,
  };
}

function workerRuntimeEnv(args: CliArgs): {
  databaseUrl: string;
  defaultRepoSlug?: string;
  projectConfigPath?: string;
  dockerBin?: string;
  workerImage?: string;
  runtimeOverride?: string;
  piProvider: string;
  piModel: string;
  piStoreRequests: boolean;
  workerLeaseMinutes: number;
  boardProjectId?: string;
  autobounceHuman?: string;
  workerId?: string;
  inlineCompletion?: boolean;
} {
  const provider = process.env.REMOTE_AGENT_PI_DEFAULT_PROVIDER ?? process.env.REMOTE_AGENT_PI_PROVIDER ?? 'openai';
  const model = process.env.REMOTE_AGENT_PI_DEFAULT_MODEL ?? process.env.REMOTE_AGENT_PI_MODEL ?? 'gpt-5.4-mini';
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the board worker/api/control runtime.');
  return {
    databaseUrl,
    defaultRepoSlug: process.env.REMOTE_AGENT_BOARD_PROJECT_ID ?? 'sample/service',
    projectConfigPath: process.env.REMOTE_AGENT_PROJECTS_CONFIG,
    dockerBin: process.env.REMOTE_AGENT_DOCKER_BIN ?? 'docker',
    workerImage: process.env.REMOTE_AGENT_WORKER_IMAGE,
    runtimeOverride: process.env.REMOTE_AGENT_WORKER_RUNTIME,
    piProvider: provider,
    piModel: model,
    piStoreRequests: process.env.REMOTE_AGENT_PI_STORE_REQUESTS !== 'false',
    workerLeaseMinutes: args.workerLeaseMinutes,
    boardProjectId: process.env.REMOTE_AGENT_BOARD_PROJECT_ID ?? 'sample/service',
    autobounceHuman: process.env.REMOTE_AGENT_AUTOBOUNCE_HUMAN ?? 'user-dev',
    workerId: args.workerId,
    inlineCompletion: false,
  };
}

async function runWorkerLoop(args: CliArgs): Promise<void> {
  process.env.WORKER_ID = args.workerId;
  warnIfNoProviderCreds('worker');
  const runtime = await wireWorkerRuntime(workerRuntimePaths(args), workerRuntimeEnv(args));

  const reaperMs = Math.max(30_000, Math.min(args.pollIntervalMs * 6, 120_000));
  const reaperTimer = setInterval(() => {
    void runtime.workerScheduler.reapExpiredLeases().catch((error) => {
      process.stderr.write(`worker.reap_failed error=${formatError(error)}\n`);
    });
  }, reaperMs);

  const sweepHandle = maybeStartSnapshotSweep(runtime, 'worker');
  const health = args.healthPort
    ? await startHealthServer(async () => {
        try {
          await runtime.pool.query('SELECT 1');
          return { live: true, ready: true, detail: { database: 'up' } };
        } catch {
          return { live: true, ready: false, detail: { database: 'down' } };
        }
      }, { port: args.healthPort })
    : null;

  process.stdout.write(`worker.ready workerId=${args.workerId} mode=session-worker\n`);

  let stopped = false;
  let cancelSleep: (() => void) | null = null;
  const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { cancelSleep = null; resolve(); }, ms);
    cancelSleep = () => { clearTimeout(timer); cancelSleep = null; resolve(); };
  });

  const drain = (async () => {
    try {
      while (!stopped) {
        const result = await runtime.workerScheduler.claimAndRun();
        if (!result) {
          if (args.once) return;
          await sleep(args.pollIntervalMs);
          continue;
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (args.once) return;
      }
    } finally {
      clearInterval(reaperTimer);
    }
  })();

  if (args.once) {
    try { await drain; } finally {
      await sweepHandle?.stop().catch(() => {});
      await health?.close().catch(() => {});
      await runtime.close();
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.stdout.write(`worker.stopping workerId=${args.workerId}\n`);
      stopped = true;
      cancelSleep?.();
      drain.finally(async () => {
        await sweepHandle?.stop().catch(() => {});
        await health?.close().catch(() => {});
        await runtime.close().catch(() => {});
        process.stdout.write(`worker.stopped workerId=${args.workerId}\n`);
        resolve();
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

async function runControlProcess(args: CliArgs): Promise<void> {
  const paths = workerRuntimePaths(args);
  const env = workerRuntimeEnv(args);
  const runtime = await wireControlRuntime(
    { workerAssetsRoot: paths.workerAssetsRoot, repoOverrideRoot: paths.repoOverrideRoot },
    {
      databaseUrl: env.databaseUrl,
      projectConfigPath: env.projectConfigPath,
      defaultRepoSlug: env.defaultRepoSlug,
      boardProjectId: env.boardProjectId,
      autobounceHuman: env.autobounceHuman,
    },
  );
  const health = args.healthPort
    ? await startHealthServer(async () => {
        try {
          await runtime.persistence.pool.query('SELECT 1');
          return { live: true, ready: true, detail: { database: 'up' } };
        } catch {
          return { live: true, ready: false, detail: { database: 'down' } };
        }
      }, { port: args.healthPort })
    : null;
  const handle: ControlLoopHandle = startControlLoop({
    driver: runtime.driver,
    pollIntervalMs: args.pollIntervalMs,
    controlId: args.controlId,
  });

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.stdout.write(`control.stopping controlId=${args.controlId}\n`);
      handle.stop().finally(async () => {
        await health?.close().catch(() => {});
        await runtime.close().catch(() => {});
        resolve();
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

async function runReconcilerProcess(args: CliArgs): Promise<void> {
  const env = workerRuntimeEnv(args);
  const runtime = await wireReconcilerRuntime({
    databaseUrl: env.databaseUrl,
    dockerBin: env.dockerBin,
  });
  process.stdout.write(`reconciler.ready controlId=${args.controlId}\n`);
  const health = args.healthPort
    ? await startHealthServer(async () => {
        try {
          await runtime.persistence.pool.query('SELECT 1');
          return { live: true, ready: true, detail: { database: 'up' } };
        } catch {
          return { live: true, ready: false, detail: { database: 'down' } };
        }
      }, { port: args.healthPort })
    : null;
  let stopped = false;
  let cancelSleep: (() => void) | null = null;
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    cancelSleep = () => { clearTimeout(timer); resolve(); };
  });
  const loop = (async () => {
    while (!stopped) {
      try {
        const result = await runtime.reconcileOnce();
        process.stdout.write(
          `reconciler.pass inspected=${result.inspected.length} retained=${result.retained.length} terminated=${result.terminated.length}\n`,
        );
      } catch (error) {
        process.stderr.write(`reconciler.failed error=${formatError(error)}\n`);
      }
      if (stopped) break;
      await sleep(Math.max(5000, args.pollIntervalMs));
    }
  })();
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.stdout.write('reconciler.stopping\n');
      stopped = true;
      cancelSleep?.();
      loop.finally(async () => {
        await health?.close().catch(() => {});
        await runtime.close().catch(() => {});
        resolve();
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

interface BoardApi {
  handler: (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;
  close: () => Promise<void>;
  /** Optional reconciler stop hook (only set when --with-worker is on). */
  stopReconciler?: () => Promise<void>;
}

/**
 * Construct the read/write board UI API over Postgres. Port-based (BoardStore
 * + session repos + agent_runs); plane-separated from the worker drain.
 * Degrades to `null` (Board UI shows an empty/offline state) when DATABASE_URL
 * is absent or the runtime fails to wire.
 *
 * When `args.withWorker` is false (production / SaaS default), this function
 * does **not** start the embedded worker drain or board reconciler — those
 * belong to `--role worker` and `--role control` respectively. Pass
 * `--with-worker` to restore the all-in-one local-dev behavior.
 */
async function maybeCreateBoardApi(args: CliArgs): Promise<BoardApi | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stdout.write('api.board_disabled reason=no_database_url\n');
    return null;
  }

  const paths = workerRuntimePaths(args);
  let apiRuntime;
  try {
    apiRuntime = await wireApiRuntime(
      { runsRoot: paths.runsRoot, workerAssetsRoot: paths.workerAssetsRoot, repoOverrideRoot: paths.repoOverrideRoot },
      {
        databaseUrl,
        projectConfigPath: process.env.REMOTE_AGENT_PROJECTS_CONFIG,
        tenantId: process.env.REMOTE_AGENT_BOARD_TENANT_ID ?? 'default',
        projectId: process.env.REMOTE_AGENT_BOARD_PROJECT_ID ?? 'sample/service',
        defaultRepoSlug: process.env.REMOTE_AGENT_BOARD_PROJECT_ID ?? 'sample/service',
      },
    );
  } catch (error) {
    process.stderr.write(`api.board_runtime_failed error=${formatError(error)}\n`);
    return null;
  }

  const projectId = process.env.REMOTE_AGENT_BOARD_PROJECT_ID ?? 'sample/service';

  const handler = createBoardApiHandler({
    service: apiRuntime.service,
    controlAuthRequired: Boolean(args.apiToken),
    authorize: (request) => isAuthorized(request, args.apiToken),
    readActor,
    healthCheck: async () => {
      try {
        await apiRuntime.persistence.pool.query('SELECT 1');
        return { database: 'up' };
      } catch {
        return { database: 'down' };
      }
    },
  });

  let controlHandle: ControlLoopHandle | null = null;
  let drainHandle: EmbeddedWorkerDrainHandle | null = null;
  let sweepHandle: SnapshotSweepHandle | null = null;
  let workerRuntime: WorkerRuntime | null = null;
  if (args.withWorker) {
    warnIfNoProviderCreds('api.dev_worker');
    workerRuntime = await wireWorkerRuntime(paths, {
      ...workerRuntimeEnv(args),
      inlineCompletion: true,
      workerId: args.workerId,
    });
    const pollMs = Math.max(2000, args.pollIntervalMs);
    controlHandle = startControlLoop({
      driver: workerRuntime.driver,
      pollIntervalMs: pollMs,
      controlId: `api-${args.controlId}`,
    });
    drainHandle = startEmbeddedWorkerDrain({
      scheduler: workerRuntime.workerScheduler,
      pollIntervalMs: pollMs,
    });
    sweepHandle = maybeStartSnapshotSweep(workerRuntime, 'api.dev_worker');
    process.stdout.write('api.dev_mode with_worker=true\n');
  } else {
    process.stdout.write('api.http_only with_worker=false\n');
  }

  process.stdout.write(`api.board_ready project=${projectId}\n`);
  return {
    handler,
    close: async () => {
      await workerRuntime?.close().catch(() => {});
      await apiRuntime.close();
    },
    stopReconciler: async () => {
      await Promise.allSettled([
        controlHandle ? controlHandle.stop() : Promise.resolve(),
        drainHandle ? drainHandle.stop() : Promise.resolve(),
        sweepHandle ? sweepHandle.stop() : Promise.resolve(),
      ]);
    },
  };
}

async function runApiServer(args: CliArgs): Promise<void> {
  const boardApi = await maybeCreateBoardApi(args);
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  // Built SPA lives at packages/web/dist; this file runs from packages/scheduler/dist.
  const webDist = path.resolve(thisDir, '../../web/dist');

  const server = http.createServer((request, response) => {
    void handleServerRequest(boardApi, webDist, request, response);
  });

  server.on('error', (error) => {
    process.stderr.write(`api.server_error error=${formatError(error)}\n`);
  });

  await new Promise<void>((resolve) => {
    server.listen(args.apiPort, '0.0.0.0', resolve);
  });

  process.stdout.write(`api.ready port=${args.apiPort} withWorker=${args.withWorker}\n`);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.stdout.write('api.stopping\n');
      const reconcilerDone = boardApi?.stopReconciler?.() ?? Promise.resolve();
      Promise.resolve(reconcilerDone).finally(() => {
        server.close(() => {
          void Promise.allSettled([boardApi?.close() ?? Promise.resolve()]).finally(resolve);
        });
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

const WEB_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serve the built board SPA under `/app` (and via `/` redirect). Unknown
 * sub-paths fall back to index.html so client-side routing works.
 */
async function serveWebAsset(webDist: string, url: URL, response: ServerResponse): Promise<void> {
  const relative = url.pathname.replace(/^\/app\/?/, '');
  const indexPath = path.join(webDist, 'index.html');

  const candidate = relative ? path.join(webDist, relative) : indexPath;
  // Confine to webDist (defense-in-depth against path traversal).
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(path.resolve(webDist))) {
    writeText(response, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  const targets = relative && path.extname(resolved) ? [resolved] : [resolved, indexPath];
  for (const target of targets) {
    try {
      const body = await fs.readFile(target);
      const mime = WEB_MIME_TYPES[path.extname(target)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      response.end(body);
      return;
    } catch {
      /* try the next candidate (SPA fallback) */
    }
  }

  writeText(
    response,
    404,
    'Board UI not built. Run `npm run build:web`.',
    'text/plain; charset=utf-8',
  );
}

async function handleServerRequest(
  boardApi: BoardApi | null,
  webDist: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (request.method === 'OPTIONS') {
    writeEmpty(response, 204);
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    if (boardApi) {
      const handled = await boardApi.handler(request, response, url);
      if (handled) return;
    } else {
      writeJson(response, 503, {
        error: 'board_api_unavailable',
        message: 'Board API requires DATABASE_URL.',
      });
      return;
    }
  }

  if (url.pathname === '/' && (request.method ?? 'GET') === 'GET') {
    response.writeHead(302, { location: '/app/', 'cache-control': 'no-store' });
    response.end();
    return;
  }

  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    await serveWebAsset(webDist, url, response);
    return;
  }

  writeJson(response, 404, { error: 'not_found' });
}

function readActor(request: IncomingMessage): string {
  const header = request.headers['x-remote-agent-actor'];
  if (Array.isArray(header)) return header[0] ?? 'operator';
  return header || 'operator';
}

function isAuthorized(request: IncomingMessage, apiToken: string | undefined): boolean {
  if (!apiToken) return true;
  const tokenHeader = request.headers['x-remote-agent-token'];
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  if (token && secureEqual(token, apiToken)) return true;

  const authorization = request.headers.authorization;
  if (!authorization) return false;
  const [scheme, value] = authorization.split(/\s+/, 2);
  if (/^bearer$/i.test(scheme) && value) return secureEqual(value, apiToken);
  if (/^basic$/i.test(scheme) && value) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const password = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
    return secureEqual(password, apiToken);
  }
  return false;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-remote-agent-token, x-remote-agent-actor',
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeText(
  response: ServerResponse,
  statusCode: number,
  payload: string,
  contentType: string,
): void {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function writeEmpty(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-remote-agent-token, x-remote-agent-actor',
  });
  response.end();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loud startup warning when no provider credentials are visible to the
 * worker process. The pi-runner only sees the keys in `PI_RUNNER_ENV_KEYS`
 * (OPENAI_API_KEY / ANTHROPIC_API_KEY / PI_API_KEY); a worker started from
 * a bare shell that didn't source `.env` will successfully claim a task and
 * then mysteriously fail inside the container with "OpenAI API key is
 * required". Surfacing this at `*.ready` time turns a confusing in-container
 * failure into an obvious operator message.
 *
 * This is intentionally a warning (not a hard exit): the operator may be
 * pointing at a profile that uses a different credential source, or staging
 * the process before the env is in place. Hard-fail would regress the
 * existing test/dev workflows.
 */
/**
 * Start the snapshot retention sweep for any role that owns the local
 * snapshot store. Controlled by env vars so operators can dial it without
 * a redeploy:
 *
 *   REMOTE_AGENT_SNAPSHOT_RETENTION_DAYS    default 30
 *   REMOTE_AGENT_SNAPSHOT_MIN_KEEP          default 3 (per task)
 *   REMOTE_AGENT_SNAPSHOT_SWEEP_INTERVAL_MS default 6h, clamped >=60s
 *   REMOTE_AGENT_SNAPSHOT_ORPHAN_POLICY     'delete-if-old' | 'keep'
 *   REMOTE_AGENT_SNAPSHOT_SWEEP_DRY_RUN     '1' to plan only
 *   REMOTE_AGENT_SNAPSHOT_SWEEP_DISABLED    '1' to skip entirely
 *
 * Returns `null` if disabled — `runtime.close()` still tears the rest down
 * cleanly.
 */
function maybeStartSnapshotSweep(runtime: WorkerRuntime, roleLabel: string): SnapshotSweepHandle | null {
  if (process.env.REMOTE_AGENT_SNAPSHOT_SWEEP_DISABLED === '1') {
    process.stdout.write(`${roleLabel}.snapshot_sweep_disabled\n`);
    return null;
  }
  const days = Number(process.env.REMOTE_AGENT_SNAPSHOT_RETENTION_DAYS ?? '30');
  const minKeep = Number(process.env.REMOTE_AGENT_SNAPSHOT_MIN_KEEP ?? '3');
  const intervalEnv = Number(process.env.REMOTE_AGENT_SNAPSHOT_SWEEP_INTERVAL_MS ?? `${6 * 60 * 60 * 1000}`);
  const policy: SnapshotSweepPolicy = {
    maxAgeMs: Number.isFinite(days) && days > 0 ? days * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000,
    minKeepPerTask: Number.isFinite(minKeep) && minKeep >= 0 ? Math.floor(minKeep) : 3,
    orphanPolicy: process.env.REMOTE_AGENT_SNAPSHOT_ORPHAN_POLICY === 'keep' ? 'keep' : 'delete-if-old',
    dryRun: process.env.REMOTE_AGENT_SNAPSHOT_SWEEP_DRY_RUN === '1',
  };
  // Wiring-layer floor (the library doesn't enforce one so tests can run fast).
  const intervalMs = Math.max(60_000, Number.isFinite(intervalEnv) ? intervalEnv : 6 * 60 * 60 * 1000);

  return startSnapshotRetentionSweep({
    store: runtime.localSnapshotStore,
    runs: { listSnapshotRefs: () => runtime.agentRuns.listSnapshotRefs() },
    intervalMs,
    policy,
    logger: {
      log: (m) => process.stdout.write(`${roleLabel}.${m}\n`),
      error: (m) => process.stderr.write(`${roleLabel}.${m}\n`),
    },
  });
}

function warnIfNoProviderCreds(roleLabel: string): void {
  const providerKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PI_API_KEY'];
  const present = providerKeys.filter((key) => {
    const value = process.env[key];
    return typeof value === 'string' && value.length > 0;
  });
  if (present.length === 0) {
    process.stderr.write(
      `${roleLabel}.no_provider_creds — none of ${providerKeys.join(', ')} are set in the ` +
      `worker process env. Pi inside the sandbox will fail with "API key is required". ` +
      `Fix: \`set -a && source .env && set +a\` before launching the worker.\n`,
    );
  } else {
    process.stdout.write(`${roleLabel}.provider_creds present=${present.join(',')}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

// Public exports for tests and external composition. The module itself
// still self-executes via `main()` when invoked directly (the shebang
// path), so this is purely additive.
export { parseArgs } from './wiring/cli-args.js';
export type { CliArgs, ServiceRole } from './wiring/cli-args.js';
export { startControlLoop } from './wiring/control-loop.js';
export { startEmbeddedWorkerDrain } from './wiring/embedded-worker-drain.js';
export {
  planSnapshotSweep,
  runSnapshotSweep,
  startSnapshotRetentionSweep,
  DEFAULT_SWEEP_POLICY,
} from './wiring/snapshot-retention.js';
export type {
  SnapshotMeta,
  SnapshotSweepPolicy,
  SnapshotSweepPlan,
  SnapshotSweepResult,
  SnapshotSweepHandle,
  SnapshotStoreOps,
  AgentRunsRefSource,
  AgentRunSnapshotRef,
} from './wiring/snapshot-retention.js';
