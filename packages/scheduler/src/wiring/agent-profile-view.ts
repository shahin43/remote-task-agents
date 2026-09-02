import type { WorkerProfile } from '@remote-sandbox-agents/contracts';

export interface AgentProfileView {
  id: string;
  displayName: string;
  profileId: string;
  /** Short human description (first paragraph of SOUL.md). */
  description: string | null;
  engine: string;
  runtime: string;
  model: string | null;
  sandbox: string | null;
  approvalPolicy: string | null;
  limits: {
    /** Total wall-clock runtime budget in minutes. */
    maxRuntimeMinutes: number | null;
    /** Maximum number of tool invocations per run. */
    maxToolCalls: number | null;
  };
  workspaceRetention: string | null;
  scope: {
    allowedRepos: string[];
    allowedMountTypes: string[];
    maxMountedPaths: number | null;
    pathDenylist: string[];
    egressAllowlist: string[];
  };
  /** Repo-relative path to the YAML profile (config-driven). */
  configPath: string;
  /** Provenance — service-default vs repo-per-profile vs repo-legacy. */
  source: 'service-default' | 'repo-per-profile' | 'repo-legacy' | 'api';
}

/** First non-heading paragraph of SOUL.md, used as the agent's description. */
function descriptionFromSoul(soul: string | undefined): string | null {
  if (!soul) return null;
  const lines = soul.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (out.length > 0) break;
      continue;
    }
    if (line.startsWith('#')) continue;
    out.push(line);
  }
  return out.length > 0 ? out.join(' ') : null;
}

export function toAgentProfileView(
  agent: { id: string; displayName: string; profileId: string },
  profile: WorkerProfile,
  extras?: {
    soul?: string;
    source?: 'service-default' | 'repo-per-profile' | 'repo-legacy' | 'api';
  },
): AgentProfileView {
  const policy = profile.scopePolicy;
  return {
    id: agent.id,
    displayName: agent.displayName,
    profileId: agent.profileId,
    description: descriptionFromSoul(extras?.soul),
    engine: profile.engine,
    runtime: profile.runtime,
    model: profile.modelDefaults?.model ?? null,
    sandbox: profile.modelDefaults?.sandbox ?? null,
    approvalPolicy: profile.modelDefaults?.approvalPolicy ?? profile.approvalPolicy ?? null,
    limits: {
      maxRuntimeMinutes: profile.limits?.maxRuntimeMinutes ?? null,
      maxToolCalls: profile.limits?.maxToolCalls ?? null,
    },
    workspaceRetention: profile.workspaceRetention ?? null,
    scope: {
      allowedRepos: policy?.allowedRepos ?? [],
      allowedMountTypes: policy?.allowedMountTypes ?? [],
      maxMountedPaths: policy?.maxMountedPaths ?? null,
      pathDenylist: policy?.pathDenylist ?? [],
      egressAllowlist: policy?.egressAllowlist ?? [],
    },
    configPath: `agents/${agent.profileId}/profile.yaml`,
    source: extras?.source ?? 'service-default',
  };
}
