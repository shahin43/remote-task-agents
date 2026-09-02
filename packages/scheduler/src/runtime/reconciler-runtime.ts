import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { wireSharedPersistence, type SharedPersistence } from './shared-persistence.js';
import {
  reconcileDockerResources,
  type DockerResource,
  type LiveOwnership,
  type ReconcileResult,
} from './fenced-reaper.js';

const execFileAsync = promisify(execFile);

export interface ReconcilerRuntimeEnv {
  databaseUrl: string;
  dockerBin?: string;
}

export interface ReconcilerRuntime {
  persistence: SharedPersistence;
  reconcileOnce: () => Promise<ReconcileResult>;
  close: () => Promise<void>;
}

export async function wireReconcilerRuntime(env: ReconcilerRuntimeEnv): Promise<ReconcilerRuntime> {
  const persistence = await wireSharedPersistence({ databaseUrl: env.databaseUrl });
  const dockerBin = env.dockerBin ?? process.env.REMOTE_AGENT_DOCKER_BIN ?? 'docker';

  const reconcileOnce = async (): Promise<ReconcileResult> => {
    const resources = await listLabeledContainers(dockerBin);
    const now = new Date().toISOString();
    const expired = await persistence.sessions.listExpiredRunning('worker', now);
    const expiredIds = new Set(expired.map((s) => s.id));
    const live = await persistence.agentRuns.listLive();
    const ownership: LiveOwnership[] = [];
    const seen = new Set<string>();
    for (const session of expired) {
      ownership.push({
        sessionId: session.id,
        leaseGeneration: session.leaseGeneration ?? 0,
        leaseExpired: true,
      });
      seen.add(session.id);
    }
    for (const run of live) {
      if (seen.has(run.sessionId)) continue;
      const session = await persistence.sessions.findById(run.sessionId);
      if (!session) continue;
      ownership.push({
        sessionId: session.id,
        leaseGeneration: session.leaseGeneration ?? 0,
        leaseExpired: expiredIds.has(session.id),
      });
      seen.add(session.id);
    }
    return reconcileDockerResources({
      resources,
      ownership,
      terminate: async (id) => {
        await execFileAsync(dockerBin, ['rm', '-f', id]).catch(() => undefined);
      },
    });
  };

  return { persistence, reconcileOnce, close: persistence.close };
}

async function listLabeledContainers(dockerBin: string): Promise<DockerResource[]> {
  try {
    const { stdout } = await execFileAsync(dockerBin, [
      'ps', '-aq',
      '--filter', 'label=project=remote-sandbox-agents',
      '--format', '{{.ID}}\t{{.Label "session_id"}}\t{{.Label "run_id"}}\t{{.Label "lease_generation"}}',
    ]);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [containerId, sessionId, runId, gen] = line.split('\t');
        return {
          containerId,
          sessionId: sessionId || undefined,
          runId: runId || undefined,
          leaseGeneration: gen ? Number(gen) : undefined,
        };
      });
  } catch {
    return [];
  }
}
