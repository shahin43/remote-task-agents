import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentConfigLoader, BoardAssignmentRouter } from '@remote-sandbox-agents/orchestrator';
import { BoardChannelDriver } from '@remote-sandbox-agents/channels';
import type { ControlLoopDriver } from '../wiring/control-loop.js';
import { buildBoardSessionMetadata } from '../wiring/board-session-metadata.js';
import { extraProfilesLoader } from '../wiring/agent-profile-document.js';
import { makeResolveTargetAsync } from '../wiring/resolve-target.js';
import { agentSkillsRootFor, loadMergedSkillCatalog } from '../wiring/skill-catalog.js';
import { projectPendingCompletions } from './completion-projector.js';
import { wireSharedPersistence, type SharedPersistence } from './shared-persistence.js';

export interface ControlRuntimePaths {
  workerAssetsRoot: string;
  repoOverrideRoot?: string;
}

export interface ControlRuntimeEnv {
  databaseUrl: string;
  projectConfigPath?: string;
  defaultRepoSlug?: string;
  boardProjectId?: string;
  autobounceHuman?: string;
}

export interface ControlRuntime {
  persistence: SharedPersistence;
  router: BoardAssignmentRouter;
  driver: ControlLoopDriver;
  close: () => Promise<void>;
}

export async function wireControlRuntime(
  paths: ControlRuntimePaths,
  env: ControlRuntimeEnv,
): Promise<ControlRuntime> {
  const persistence = await wireSharedPersistence({
    databaseUrl: env.databaseUrl,
    projectConfigPath: env.projectConfigPath,
  });

  const extraProfiles = extraProfilesLoader(
    persistence.agentProfiles,
    process.env.REMOTE_AGENT_BOARD_TENANT_ID ?? 'default',
  );
  const workerConfigLoader = new AgentConfigLoader({
    serviceDefaultRoot: paths.workerAssetsRoot,
    repoOverrideRoot: paths.repoOverrideRoot,
    extraProfiles,
  });
  const resolveTarget = makeResolveTargetAsync({ board: persistence.board, configLoader: workerConfigLoader });
  const defaultRepoSlug = env.defaultRepoSlug ?? 'sample/service';
  const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
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
    skillCatalogCache.set(key, discovered.skills);
    return discovered.skills;
  };

  const router = new BoardAssignmentRouter({
    board: persistence.board,
    sessions: persistence.sessions,
    bus: persistence.bus,
    generateId: () => crypto.randomUUID(),
    resolveTarget,
    buildMetadata: (task, target) => buildBoardSessionMetadata(
      { projects: persistence.projects, configLoader: workerConfigLoader, defaultRepoSlug, skillCatalog },
      task,
      target,
    ),
    onRouted: async (task, outcome) => {
      if (task.status === 'done' || task.status === 'failed') return;
      if (!outcome.created || task.status !== 'backlog') return;
      await persistence.board.updateStatus({
        taskId: task.id,
        status: 'triaging',
        by: task.assigneeId ?? 'system',
      });
    },
  });

  const boardDriver = new BoardChannelDriver({
    board: persistence.board,
    route: (taskId) => router.route(taskId),
    projectId: env.boardProjectId,
  });

  const driver: ControlLoopDriver = {
    pollOnce: async () => {
      const result = await boardDriver.pollOnce();
      await projectPendingCompletions({
        board: persistence.board,
        sessions: persistence.sessions,
        router,
        autobounceHuman: env.autobounceHuman,
      });
      return result;
    },
  };

  return { persistence, router, driver, close: persistence.close };
}
