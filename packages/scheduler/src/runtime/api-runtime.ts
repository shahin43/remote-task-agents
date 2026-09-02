import path from 'node:path';
import { boardConversationKey } from '@remote-sandbox-agents/contracts';
import { WorkerProfileLoader } from '@remote-sandbox-agents/worker';
import { AgentConfigLoader } from '@remote-sandbox-agents/orchestrator';
import type { BoardStore, SessionsRepo } from '@remote-sandbox-agents/persistence';
import { BoardApiService } from '../api/board-api.js';
import { SessionContinuationService } from '../wiring/session-continuation.js';
import { extraProfilesLoader } from '../wiring/agent-profile-document.js';
import { toAgentProfileView } from '../wiring/agent-profile-view.js';
import { ensureBoardDevPrincipals } from '../wiring/ensure-board-principals.js';
import { BoardSnapshotService } from '../control/board-snapshots/service.js';
import { createBoardSnapshotStores } from '../control/board-snapshots/create-stores.js';
import { wireSharedPersistence, type SharedPersistence } from './shared-persistence.js';

export interface ApiRuntimePaths {
  runsRoot: string;
  workerAssetsRoot: string;
  repoOverrideRoot?: string;
}

export interface ApiRuntimeEnv {
  databaseUrl: string;
  projectConfigPath?: string;
  tenantId?: string;
  projectId?: string;
  defaultRepoSlug?: string;
}

export interface ApiRuntime {
  persistence: SharedPersistence;
  service: BoardApiService;
  close: () => Promise<void>;
}

export async function wireApiRuntime(
  paths: ApiRuntimePaths,
  env: ApiRuntimeEnv,
): Promise<ApiRuntime> {
  const persistence = await wireSharedPersistence({
    databaseUrl: env.databaseUrl,
    projectConfigPath: env.projectConfigPath,
  });

  const tenantId = env.tenantId ?? 'default';
  const projectId = env.projectId ?? env.defaultRepoSlug ?? 'sample/service';
  await ensureBoardDevPrincipals({ board: persistence.board, tenantId, projectId });

  const snapshotRoot = path.resolve(paths.runsRoot, 'snapshots');
  const snapshotStores = createBoardSnapshotStores({ snapshotRoot });
  const continuation = new SessionContinuationService({
    sessions: persistence.sessions,
    sessionEvents: persistence.sessionEvents,
    bus: persistence.bus,
  });
  const extraProfiles = extraProfilesLoader(persistence.agentProfiles, tenantId);
  const workerLoader = new WorkerProfileLoader({
    assetsRoot: paths.workerAssetsRoot,
    repoOverrideRoot: paths.repoOverrideRoot,
    extraProfiles,
  });
  const workerConfigLoader = new AgentConfigLoader({
    serviceDefaultRoot: paths.workerAssetsRoot,
    repoOverrideRoot: paths.repoOverrideRoot,
    extraProfiles,
  });

  const service = new BoardApiService({
    board: persistence.board,
    sessions: persistence.sessions,
    sessionEvents: persistence.sessionEvents,
    agentRuns: persistence.agentRuns,
    agentProfiles: persistence.agentProfiles,
    tenantId,
    projectId,
    projects: persistence.projects,
    snapshotStore: snapshotStores.persistStore,
    snapshotStores: snapshotStores.router,
    snapshotBrowser: new BoardSnapshotService(snapshotStores.router),
    snapshotRoot,
    defaultRepoSlug: env.defaultRepoSlug ?? env.projectId ?? 'sample/service',
    promotionRoot: path.resolve(paths.runsRoot, 'promotions'),
    followUp: (channelOrigin, text, opts) =>
      continuation.continue({
        channelOrigin,
        text,
        actor: opts?.actor ?? 'operator',
        resumeWorkspace: opts?.resumeWorkspace,
        trigger: 'api',
      }),
    resolveAgentProfile: async (agentId) => {
      const agents = await persistence.board.listAgents(projectId);
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return null;
      const cfg = await workerConfigLoader.resolve(agent.profileId).catch(() => null);
      const profile = await workerLoader.get(agent.profileId).catch(() => null);
      if (!profile) return null;
      return toAgentProfileView(
        { id: agent.id, displayName: agent.displayName, profileId: agent.profileId },
        profile,
        cfg ? { soul: cfg.soul, source: cfg.sources.profile } : undefined,
      );
    },
    listProfileTemplates: async () => {
      const profiles = await workerLoader.list();
      const out = [];
      for (const profile of profiles) {
        const cfg = await workerConfigLoader.resolve(profile.id).catch(() => null);
        const soul = cfg?.soul ?? '';
        const description = soul
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))[0] ?? null;
        out.push({
          id: profile.id,
          actor: 'worker' as const,
          engine: profile.engine,
          runtime: profile.runtime,
          model: profile.modelDefaults?.model ?? null,
          description,
        });
      }
      return out;
    },
    agentHasActiveSessions: (agentId) =>
      hasActiveWorkerSessions(persistence.board, persistence.sessions, projectId, agentId),
  });

  return {
    persistence,
    service,
    close: persistence.close,
  };
}

export async function hasActiveWorkerSessions(
  board: BoardStore,
  sessions: SessionsRepo,
  projectId: string,
  agentId: string,
): Promise<boolean> {
  const tasks = await board.listTasks({ projectId, assigneeId: agentId });
  for (const task of tasks) {
    if (task.status !== 'working' && task.status !== 'triaging') continue;
    const key = boardConversationKey(task.projectId, task.id);
    const session = await sessions.findByChannelOrigin(key);
    if (session && (session.status === 'running' || session.status === 'routing')) return true;
  }
  return false;
}
