import type { WorkerProfile } from '@remote-sandbox-agents/contracts';
import { AgentConfigLoader, toWorkerProfile, type AgentConfigLoaderOptions } from '@remote-sandbox-agents/orchestrator';

export interface WorkerProfileLoaderOptions {
  /** Path to a directory that contains `agents/<id>/...` (repo root or worker dist/assets). */
  assetsRoot: string;
  /** Optional repo-local override root (target repo with .remote-agent/agents/...). */
  repoOverrideRoot?: string;
  extraProfiles?: AgentConfigLoaderOptions['extraProfiles'];
}

export class WorkerProfileLoader {
  private readonly inner: AgentConfigLoader;

  constructor(opts: WorkerProfileLoaderOptions) {
    this.inner = new AgentConfigLoader({
      serviceDefaultRoot: opts.assetsRoot,
      repoOverrideRoot: opts.repoOverrideRoot,
      extraProfiles: opts.extraProfiles,
    });
  }

  async get(profileId: string): Promise<WorkerProfile> {
    const cfg = await this.inner.resolve(profileId);
    return toWorkerProfile(cfg.profile);
  }

  async list(): Promise<WorkerProfile[]> {
    const out: WorkerProfile[] = [];
    for (const cfg of await this.inner.list()) {
      if (cfg.actor === 'worker') {
        try {
          out.push(toWorkerProfile(cfg));
        } catch {
          // skip incomplete worker entries
        }
      }
    }
    return out;
  }
}
