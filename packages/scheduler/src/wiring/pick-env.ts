/**
 * Copy only the listed keys (that are actually set) from a source env.
 */
export function pickEnv(
  keys: readonly string[],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export const PI_RUNNER_ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PI_API_KEY'] as const;
