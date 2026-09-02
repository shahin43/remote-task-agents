import type { ProviderOptions } from '@remote-sandbox-agents/sandbox';
import type { WorkerProfile, WorkerRuntimeKind } from '@remote-sandbox-agents/contracts';

export const SANDBOX_ENGINE_RUNTIMES = [
  'sandbox-docker',
  'sandbox-unix-local',
] as const satisfies readonly WorkerRuntimeKind[];

const OVERRIDABLE = new Set<string>(SANDBOX_ENGINE_RUNTIMES);

export function isSandboxRuntime(profile: WorkerProfile): boolean {
  return profile.runtime.startsWith('sandbox-');
}

export function applyRuntimeOverride(profile: WorkerProfile, override: string | undefined): WorkerProfile {
  if (!override || !OVERRIDABLE.has(override)) return profile;
  if (!isSandboxRuntime(profile)) return profile;
  if (profile.runtime === override) return profile;
  return { ...profile, runtime: override as WorkerRuntimeKind };
}

export function routeSandboxEngine(profile: WorkerProfile): ProviderOptions {
  switch (profile.runtime) {
    case 'sandbox-unix-local':
      return { type: 'unix_local' };
    case 'sandbox-docker':
      return { type: 'docker' };
    default:
      throw new Error(`runtime '${profile.runtime}' is not a sandbox runtime`);
  }
}

export function resolveProviderOptions(profile: WorkerProfile): ProviderOptions {
  return routeSandboxEngine(profile);
}
