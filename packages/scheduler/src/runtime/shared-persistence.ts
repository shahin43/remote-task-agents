import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentBus } from '@remote-sandbox-agents/contracts';
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
  type AgentProfilesRepo,
} from '@remote-sandbox-agents/persistence';
import { ProjectConfigRegistry, defaultProjectsFilePath } from '../wiring/project-config.js';

export interface SharedPersistenceEnv {
  databaseUrl: string;
  projectConfigPath?: string;
}

export interface SharedPersistence {
  pool: PgPool;
  board: BoardStore;
  sessions: SessionsRepo;
  sessionEvents: SessionEventsRepo;
  agentRuns: AgentRunsRepo;
  agentProfiles: AgentProfilesRepo;
  bus: AgentBus;
  pgBus: PostgresAgentBus;
  projects: ProjectConfigRegistry;
  close: () => Promise<void>;
}

export function schedulerPackageRoot(fromUrl = import.meta.url): string {
  const wiringOrRuntimeDir = path.dirname(fileURLToPath(fromUrl));
  // runtime/*.ts → packages/scheduler
  return path.resolve(wiringOrRuntimeDir, '..', '..');
}

export async function wireSharedPersistence(
  env: SharedPersistenceEnv,
  opts?: { schedulerRoot?: string },
): Promise<SharedPersistence> {
  const pool = new PgPool(env.databaseUrl);
  await runMigrations(pool);

  const board = new PgBoardStore(pool);
  const sessions = new PgSessionsRepo(pool);
  const sessionEvents = new PgSessionEventsRepo(pool);
  const agentRuns = new PgAgentRunsRepo(pool);
  const agentProfiles = new PgAgentProfilesRepo(pool);
  const pgBus = new PostgresAgentBus({ connectionString: env.databaseUrl, events: sessionEvents });
  const bus: AgentBus = pgBus;

  const schedulerRoot = opts?.schedulerRoot ?? schedulerPackageRoot();
  const projectConfigPath = env.projectConfigPath ?? defaultProjectsFilePath(schedulerRoot);
  let projects: ProjectConfigRegistry;
  try {
    projects = await ProjectConfigRegistry.fromFile(projectConfigPath);
  } catch {
    projects = new ProjectConfigRegistry();
  }

  return {
    pool,
    board,
    sessions,
    sessionEvents,
    agentRuns,
    agentProfiles,
    bus,
    pgBus,
    projects,
    close: async () => {
      await pgBus.close();
      await pool.close();
    },
  };
}
