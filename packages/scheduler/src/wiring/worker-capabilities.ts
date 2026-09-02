/** Base Pi runner capabilities every worker profile receives. */
export const BASE_RUNNER_CAPABILITIES = [
  'filesystem',
  'shell',
  'apply_patch',
  'handoff',
] as const;

/** Merge profile-specific extras (e.g. `request_mr`) onto the base set. */
export function resolveRunnerCapabilities(extras?: string[]): string[] {
  const base = new Set<string>(BASE_RUNNER_CAPABILITIES);
  for (const cap of extras ?? []) {
    if (typeof cap === 'string' && cap.length > 0) base.add(cap);
  }
  return [...base];
}
