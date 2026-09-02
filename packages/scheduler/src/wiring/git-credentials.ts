/** Host-side git credentials (never forwarded into sandboxes). */
export const DEFAULT_GIT_TOKEN_ENV = 'REMOTE_AGENT_GIT_TOKEN';

const FALLBACK_TOKEN_ENVS = [DEFAULT_GIT_TOKEN_ENV, 'GIT_TOKEN'] as const;

export function resolveGitCredential(credentialEnv?: string): string | null {
  const candidates = [
    ...(credentialEnv ? [credentialEnv] : []),
    ...FALLBACK_TOKEN_ENVS,
  ];
  const seen = new Set<string>();
  for (const key of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function maskToken(text: string, token: string): string {
  if (!token || token.length === 0) return text;
  return text.split(token).join('***');
}

export function gitCloneUrl(remoteUrl: string): string {
  const url = new URL(remoteUrl);
  if (!url.username) url.username = 'git';
  return url.toString();
}

export function gitAskPassEnv(askpassPath: string): Record<string, string> {
  return {
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function safeGitError(message: string, token?: string | null): string {
  if (!token) return message;
  return maskToken(message, token);
}
