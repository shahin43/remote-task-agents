import type { EffectiveScope, MountRequest, ScopePolicy, ScopeRequest } from '@remote-sandbox-agents/contracts';

/** Thrown when a request exceeds the policy ceiling. Carries a reason for the scope_denied action. */
export class ScopeDeniedError extends Error {
  constructor(public readonly reason: string, public readonly detail: Record<string, unknown> = {}) {
    super(reason);
    this.name = 'ScopeDeniedError';
  }
}

/** Translate a simple glob (`**`, `*`) to a RegExp anchored at both ends. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*');
  return new RegExp(`^${pattern}$`);
}

/**
 * effective scope = request ∩ policy.
 * The orchestrator LLM can only NARROW; any path/repo/mount outside policy throws ScopeDeniedError.
 */
export function clampScope(request: ScopeRequest, policy: ScopePolicy): EffectiveScope {
  const denied = (policy.pathDenylist ?? []).map(globToRegExp);
  const allowed = (policy.pathAllowlist ?? []).map(globToRegExp);

  const targetPaths = request.targetPaths ?? [];
  if (policy.maxMountedPaths !== undefined && targetPaths.length > policy.maxMountedPaths) {
    throw new ScopeDeniedError('targetPaths exceed maxMountedPaths', {
      requested: targetPaths.length, max: policy.maxMountedPaths,
    });
  }
  for (const p of targetPaths) {
    if (denied.some((re) => re.test(p))) {
      throw new ScopeDeniedError('target path is denied by policy', { path: p });
    }
    if (allowed.length > 0 && !allowed.some((re) => re.test(p))) {
      throw new ScopeDeniedError('target path is outside the policy allowlist', { path: p });
    }
  }

  const mounts: MountRequest[] = [];
  for (const m of request.mounts ?? []) {
    if (!policy.allowedMountTypes.includes(m.kind)) {
      throw new ScopeDeniedError('mount kind not allowed by policy', { kind: m.kind, allowed: policy.allowedMountTypes });
    }
    if (m.kind === 'git' && !policy.allowedRepos.includes(m.ref)) {
      throw new ScopeDeniedError('git repo not in allowedRepos', { repo: m.ref, allowed: policy.allowedRepos });
    }
    mounts.push(m);
  }

  return { targetPaths, mounts };
}
