import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentBus, SessionRecord, WorkerProfile } from '@remote-sandbox-agents/contracts';
import { parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import {
  AgentConfigLoader,
  BoardAssignmentRouter,
  WorkspaceManager,
} from '@remote-sandbox-agents/orchestrator';
import { WorkerProfileLoader } from '@remote-sandbox-agents/worker';
import {
  PgPool,
  PgBoardStore,
  PgSessionsRepo,
  PgSessionEventsRepo,
  PgAgentRunsRepo,
  PgAgentProfilesRepo,
  PostgresAgentBus,
  runMigrations,
  type AgentRunsRepo,
  type BoardStore,
  type SessionsRepo,
  type SessionEventsRepo,
} from '@remote-sandbox-agents/persistence';
import { BoardChannelDriver } from '@remote-sandbox-agents/channels';
import { SandboxManager, LocalSnapshotStore, UnixLocalSandboxProvider, DockerSandboxProvider, DEFAULT_PI_AGENT_IMAGE, type SandboxProvider, type SnapshotStore, workspaceTarUri } from '@remote-sandbox-agents/sandbox';
import type { SnapshotRef } from '@remote-sandbox-agents/sandbox';
import { BoardSnapshotService } from '../control/board-snapshots/service.js';
import { createBoardSnapshotStores, snapshotStoreKind } from '../control/board-snapshots/create-stores.js';
import { overlayHydratedSnapshot } from './hydrate-workspace.js';
import { assertSnapshotStorePolicy } from './snapshot-store-policy.js';
import type { SnapshotStoreRouter } from '../control/board-snapshots/store-router.js';
import type { ResolvedAgentConfig } from '@remote-sandbox-agents/orchestrator';
import { buildWorkerSpec } from './build-worker-spec.js';
import { manifestEnvForRuntime } from './build-worker-manifest.js';
import { prepareGitWorktree } from './prepare-git-worktree.js';
import { routeSandboxEngine, applyRuntimeOverride } from './sandbox-engine-router.js';
import { makeMirrorCache, ensureGitSeedRepo, resolveMirrorSourcePath } from './mirror-cache.js';
import { resolveGitCredential } from './git-credentials.js';
import { makeWorkerEngineResolver } from './worker-engine-resolver.js';
import { WorkerScheduler } from './worker-scheduler.js';
import { postWorkerStatus } from './board-status-back.js';
import { buildBoardSessionMetadata } from './board-session-metadata.js';
import { extraProfilesLoader } from './agent-profile-document.js';
import { makeResolveTargetAsync } from './resolve-target.js';
import { ProjectConfigRegistry, defaultProjectsFilePath } from './project-config.js';
import { pickEnv, PI_RUNNER_ENV_KEYS } from './pick-env.js';
import { buildTaskBundle, bundleToManifest, runnerScopeFileFromMetadata } from './task-bundle.js';
import { bundleSkillsFromPinned, pinnedSkillsFromMetadata } from './resolved-skills.js';
import { agentSkillsRootFor, loadMergedSkillCatalog } from './skill-catalog.js';
import { piSeedEngineFiles, promptFromSessionMetadata } from './pi-seed-files.js';
import { recordWorkerCompletion, projectWorkerCompletion } from '../runtime/completion-projector.js';
import type { ArtifactDrop, CapturedArtifact } from './artifacts.js';
import { composeWorkspaceAgentsMd } from './platform-agents-md.js';

export interface WorkerRuntimePaths {
  workspaceRoot: string;
  runsRoot: string;
  workerAssetsRoot: string;
  piRunnerBundlePath: string;
  repoOverrideRoot?: string;
}

export interface WorkerRuntimeEnv {
  databaseUrl: string;
  defaultRepoSlug?: string;
  projectConfigPath?: string;
  dockerBin?: string;
  workerImage?: string;
  runtimeOverride?: string;
  piProvider?: string;
  piModel?: string;
  piStoreRequests?: boolean;
  workerLeaseMinutes?: number;
  boardProjectId?: string;
  /**
   * Principal id (e.g. `user-dev`) the harness re-routes a task to
   * when a worker succeeds but did NOT call the `handoff` tool. Without
   * this, those tasks silently stall in `review`. Set to an empty
   * string / leave unset to disable autobounce entirely (the task will
   * remain assigned to the source agent at `review` status).
   */
  autobounceHuman?: string;
  workerId?: string;
  /**
   * When true (tests / explicit local adapter), the worker process applies
   * board completion itself. Production `--role worker` leaves this false so
   * control is the sole projector.
   */
  inlineCompletion?: boolean;
}

export interface WorkerRuntime {
  pool: PgPool;
  board: BoardStore;
  sessions: SessionsRepo;
  sessionEvents: SessionEventsRepo;
  agentRuns: AgentRunsRepo;
  bus: AgentBus;
  workerScheduler: WorkerScheduler;
  router: BoardAssignmentRouter;
  driver: BoardChannelDriver;
  projects: ProjectConfigRegistry;
  snapshotStore: SnapshotStore;
  snapshotStores: SnapshotStoreRouter;
  snapshotBrowser: BoardSnapshotService;
  localSnapshotStore: LocalSnapshotStore;
  snapshotRoot: string;
  close: () => Promise<void>;
}

function boardTaskFromSession(session: SessionRecord): { taskId: string; by: string } | null {
  const parsed = session.channelOrigin ? parseBoardConversationKey(session.channelOrigin) : null;
  if (!parsed) return null;
  return { taskId: parsed.taskId, by: session.agentSpecId };
}

export async function wireWorkerRuntime(
  paths: WorkerRuntimePaths,
  env: WorkerRuntimeEnv,
): Promise<WorkerRuntime> {
  const pool = new PgPool(env.databaseUrl);
  await runMigrations(pool);

  const board = new PgBoardStore(pool);
  const sessions = new PgSessionsRepo(pool);
  const sessionEvents = new PgSessionEventsRepo(pool);
  const agentRuns = new PgAgentRunsRepo(pool);
  const agentProfiles = new PgAgentProfilesRepo(pool);
  const pgBus = new PostgresAgentBus({ connectionString: env.databaseUrl, events: sessionEvents });
  const bus: AgentBus = pgBus;

  const defaultRepoSlug = env.defaultRepoSlug ?? 'sample/service';
  const wiringDir = path.dirname(fileURLToPath(import.meta.url));
  const schedulerRoot = path.resolve(wiringDir, '..', '..');
  const monorepoRoot = path.resolve(schedulerRoot, '..', '..');
  const projectConfigPath = env.projectConfigPath ?? defaultProjectsFilePath(schedulerRoot);
  let projects: ProjectConfigRegistry;
  try {
    projects = await ProjectConfigRegistry.fromFile(projectConfigPath);
  } catch {
    projects = new ProjectConfigRegistry();
  }

  const extraProfiles = extraProfilesLoader(
    agentProfiles,
    process.env.REMOTE_AGENT_BOARD_TENANT_ID ?? 'default',
  );
  const workerConfigLoader = new AgentConfigLoader({
    serviceDefaultRoot: paths.workerAssetsRoot,
    repoOverrideRoot: paths.repoOverrideRoot,
    extraProfiles,
  });
  const workerLoader = new WorkerProfileLoader({
    assetsRoot: paths.workerAssetsRoot,
    repoOverrideRoot: paths.repoOverrideRoot,
    extraProfiles,
  });

  const resolveTarget = makeResolveTargetAsync({ board, configLoader: workerConfigLoader });

  const platformSkillsRoot = path.join(monorepoRoot, 'platform-skills');
  const skillCatalogCache = new Map<string, Awaited<ReturnType<typeof loadMergedSkillCatalog>>['skills']>();
  const skillCatalog = async (profileId?: string) => {
    const key = profileId ?? '_platform';
    const cached = skillCatalogCache.get(key);
    if (cached) return cached;
    const discovered = await loadMergedSkillCatalog({
      platformRoot: platformSkillsRoot,
      agentSkillsRoot: profileId ? agentSkillsRootFor(paths.workerAssetsRoot, profileId) : undefined,
    });
    if (discovered.rejected.length > 0) {
      process.stderr.write(
        `skills.catalog rejected=${discovered.rejected.map((r) => r.folder).join(',')}\n`,
      );
    }
    skillCatalogCache.set(key, discovered.skills);
    return discovered.skills;
  };

  const router = new BoardAssignmentRouter({
    board,
    sessions,
    bus,
    generateId: () => crypto.randomUUID(),
    resolveTarget,
    buildMetadata: (task, target) => buildBoardSessionMetadata(
      { projects, configLoader: workerConfigLoader, defaultRepoSlug, skillCatalog },
      task,
      target,
    ),
    onRouted: async (task, outcome) => {
      if (task.status === 'done' || task.status === 'failed') return;
      // Only move backlog → triaging on a newly created session; dedup reuse or
      // tasks already working/review must not regress status.
      if (!outcome.created || task.status !== 'backlog') return;
      await board.updateStatus({
        taskId: task.id,
        status: 'triaging',
        by: task.assigneeId ?? 'system',
      });
    },
  });

  const driver = new BoardChannelDriver({
    board,
    route: (taskId) => router.route(taskId),
    projectId: env.boardProjectId,
  });

  const onWorkerStart = async (session: SessionRecord): Promise<void> => {
    const link = boardTaskFromSession(session);
    if (!link) return;
    await postWorkerStatus(board, { taskId: link.taskId, status: 'working', by: link.by });
  };

  const onWorkerComplete = async (
    session: SessionRecord,
    result: {
      status: 'succeeded' | 'failed';
      summary?: string;
      error?: string;
      handoff?: unknown;
      mrRequest?: unknown;
      artifacts?: CapturedArtifact[];
      artifactDrops?: ArtifactDrop[];
      snapshotRef?: SnapshotRef | null;
      agentRunId?: string;
    },
  ): Promise<void> => {
    await recordWorkerCompletion(sessions, session, result);
    if (env.inlineCompletion === false) return;
    await projectWorkerCompletion({
      board,
      sessions,
      router,
      session,
      result,
      autobounceHuman: env.autobounceHuman,
    });
  };

  const dockerBin = env.dockerBin ?? 'docker';

  const sandboxRoot = path.resolve(paths.workspaceRoot, 'sandboxes');
  const snapshotRoot = path.resolve(paths.runsRoot, 'snapshots');
  const mirrorRoot = path.resolve(paths.runsRoot, 'mirrors');

  const snapshotStores = createBoardSnapshotStores({ snapshotRoot });
  assertSnapshotStorePolicy({
    store: snapshotStoreKind(),
    deployment: process.env.REMOTE_AGENT_DEPLOYMENT,
    runtime: env.runtimeOverride,
  });
  const snapshotStore = snapshotStores.persistStore;
  const snapshotBrowser = new BoardSnapshotService(snapshotStores.router);

  const sandboxProviders: SandboxProvider[] = [
    new UnixLocalSandboxProvider({ workspacesRoot: sandboxRoot }),
    new DockerSandboxProvider({
      dockerBin,
      image: env.workerImage ?? DEFAULT_PI_AGENT_IMAGE,
      network: true,
      envAllowlist: [],
    }),
  ];

  const sandboxManager = new SandboxManager({
    providers: sandboxProviders,
    snapshotStore,
    clock: () => new Date().toISOString(),
  });

  const hydrateWorkspace = async (
    session: SessionRecord,
    sandboxSession: import('@remote-sandbox-agents/sandbox').SandboxSession,
    snapshotRef: SnapshotRef,
  ): Promise<void> => {
    const seedUri = workspaceTarUri(snapshotRef);
    void seedUri;
    const staging = path.resolve(paths.runsRoot, 'restore', session.id);
    await fs.rm(staging, { recursive: true, force: true });
    await snapshotStores.router.forRef(snapshotRef).restore(snapshotRef, staging);
    await overlayHydratedSnapshot({
      stagingDir: staging,
      session: sandboxSession,
      snapshotRef,
      dockerBin,
    });
    // The hydrate just bypassed `session.start()` materialize, so we must
    // re-align ownership/perms ourselves. Without this, host-uid files inside
    // the container leave the agent uid unable to write on follow-up turns.
    if (sandboxSession.alignOwnership) {
      await sandboxSession.alignOwnership();
    }
  };

  const mirrorPathForAsync = makeMirrorCache({
    cacheRoot: mirrorRoot,
    lockRoot: path.resolve(paths.runsRoot, 'state', 'mirrors', '.locks'),
    resolveCredential: resolveGitCredential,
    remoteFor: async (slug) => {
      const project = projects.resolve(env.boardProjectId ?? defaultRepoSlug, 'default', defaultRepoSlug);
      const repo = project.repos.find((r) => r.slug === slug);
      if (!repo?.remoteUrl) return null;
      return {
        remoteUrl: repo.remoteUrl,
        baseBranch: repo.baseBranch,
        fetchMode: repo.fetchMode ?? 'always',
        fetchTtlSeconds: repo.fetchTtlSeconds,
        credentialEnv: repo.credentialEnv,
      };
    },
    sourceFor: async (slug) => {
      const project = projects.resolve(env.boardProjectId ?? defaultRepoSlug, 'default', defaultRepoSlug);
      const repo = project.repos.find((r) => r.slug === slug);
      const raw =
        repo?.mirrorSource ??
        process.env.REMOTE_AGENT_MIRROR_SOURCE ??
        'runs/seed/sample-service';
      const resolved = resolveMirrorSourcePath(raw, monorepoRoot);
      if (await fs.stat(path.join(resolved, '.git', 'HEAD')).then(() => true).catch(() => false)) {
        return resolved;
      }
      const template = path.resolve(monorepoRoot, 'fixtures/sample-service');
      return ensureGitSeedRepo(resolved, template);
    },
  });

  const agentsMdFor = async (profileId: string): Promise<string> => {
    const p = path.join(paths.workerAssetsRoot, 'agents', profileId, 'AGENTS.md');
    const profileMd = await fs.readFile(p, 'utf8').catch(() => '# Worker\nWork in repo/.\n');
    return composeWorkspaceAgentsMd(profileMd);
  };

  const runtimeOverride = env.runtimeOverride;
  const resolveProfileFor = async (session: SessionRecord): Promise<WorkerProfile> =>
    applyRuntimeOverride(await workerLoader.get(session.agentSpecId), runtimeOverride);

  const workerEnv = pickEnv(['PATH', 'HOME', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
  const piProvider = env.piProvider ?? 'openai';
  const piModel = env.piModel ?? 'gpt-5.4-mini';

  const workspaceManager = new WorkspaceManager({ baseDir: path.resolve(paths.workspaceRoot, 'hermes') });

  const workerScheduler = new WorkerScheduler({
    sessions,
    agentRuns,
    bus,
    leaseMs: (env.workerLeaseMinutes ?? 45) * 60_000,
    workerId: env.workerId,
    onWorkerStart,
    onWorkerComplete,
    hydrateWorkspace,
    workspaceManager,
    resolveSpec: async (session, sessionRoot) => {
      const cfg: ResolvedAgentConfig = await workerConfigLoader.resolve(session.agentSpecId);
      return buildWorkerSpec(cfg, sessionRoot ?? paths.workspaceRoot);
    },
    resolveEngine: makeWorkerEngineResolver({
      workerEnv,
      piProvider,
      piModel,
      piStoreRequests: env.piStoreRequests,
      piRunnerBundlePath: paths.piRunnerBundlePath,
      piRunnerEnv: pickEnv(PI_RUNNER_ENV_KEYS),
    }),
    sandboxManager,
    resolveProfile: resolveProfileFor,
    resolveProviderOptionsFor: (profile, ctx) => ({
      ...routeSandboxEngine(profile),
      labels: {
        session_id: ctx?.session.id ?? '',
        run_id: ctx?.runId ?? '',
        worker_id: ctx?.workerId ?? env.workerId ?? '',
        lease_generation: String(ctx?.leaseGeneration ?? 0),
      },
    }),
    buildManifestFor: async (session, runId) => {
      const meta = session.metadata as Record<string, unknown>;
      const repo = meta.repo as { projectId: string; baseBranch?: string } | undefined;
      const eff = meta.effectiveScope as { mounts?: Array<{ kind: string; ref: string; dest: string; at?: string }> } | undefined;
      const slugs = new Set<string>();
      for (const mount of eff?.mounts ?? []) {
        if (mount.kind === 'git') slugs.add(mount.ref);
      }
      if (slugs.size === 0 && repo?.projectId) slugs.add(repo.projectId);
      const mirrorCache = new Map<string, string>();
      for (const slug of slugs) {
        mirrorCache.set(slug, await mirrorPathForAsync(slug));
      }

      const ticket = meta.ticket as { key?: string } | undefined;
      const workingBranch = `agent/${ticket?.key ?? 'task'}-${runId}`;
      const defaultBaseRef = repo?.baseBranch ?? 'main';
      const gitMounts = (eff?.mounts ?? []).filter((m) => m.kind === 'git');
      const mountsToPrep = gitMounts.length > 0
        ? gitMounts.map((m) => ({ dest: m.dest, ref: m.ref, baseRef: m.at ?? defaultBaseRef }))
        : repo
          ? [{ dest: 'repo', ref: repo.projectId, baseRef: defaultBaseRef }]
          : [];

      const worktreeRoot = path.resolve(paths.runsRoot, 'worktrees', runId);
      const worktrees = new Map<string, string>();
      for (const mount of mountsToPrep) {
        const mirrorPath = mirrorCache.get(mount.ref) ?? [...mirrorCache.values()][0] ?? '';
        const wt = await prepareGitWorktree({
          mirrorPath,
          baseRef: mount.baseRef,
          workingBranch,
          rootDir: path.join(worktreeRoot, mount.dest),
        });
        worktrees.set(mount.dest, wt);
      }

      const agentsMd = await agentsMdFor(session.agentSpecId);
      const skills = await bundleSkillsFromPinned(pinnedSkillsFromMetadata(meta));
      const cfg = await workerConfigLoader.resolve(session.agentSpecId);
      const seedFiles = piSeedEngineFiles({
        profileId: session.agentSpecId,
        soul: cfg.soul,
        basePrompt: cfg.basePrompt,
        skillIds: skills.map((s) => s.id),
        input: promptFromSessionMetadata(meta),
        provider: piProvider,
        model: cfg.profile.model?.id ?? piModel,
        maxTurns: cfg.profile.policies.maxTurns ?? 24,
        storeRequests: env.piStoreRequests,
      });
      const bundle = buildTaskBundle({
        runId,
        agentsMd,
        metadata: meta,
        mirrorPathFor: (slug) => mirrorCache.get(slug) ?? [...mirrorCache.values()][0] ?? '',
        worktreePathFor: (dest) => worktrees.get(dest) ?? '',
        skills,
        engineFiles: [runnerScopeFileFromMetadata(meta), ...seedFiles],
        env: { AGENT_ARTIFACTS_DIR: 'artifacts' },
      });
      const manifest = bundleToManifest(bundle);
      const profile = await resolveProfileFor(session);
      return { ...manifest, env: { ...manifest.env, ...manifestEnvForRuntime(profile.runtime) } };
    },
  });

  const close = async (): Promise<void> => {
    await pgBus.close();
    await pool.close();
  };

  return {
    pool,
    board,
    sessions,
    sessionEvents,
    agentRuns,
    bus,
    workerScheduler,
    router,
    driver,
    projects,
    snapshotStore,
    snapshotStores: snapshotStores.router,
    snapshotBrowser,
    localSnapshotStore: snapshotStores.local,
    snapshotRoot,
    close,
  };
}
