/**
 * Identity of the Pi agent guest image (the sandbox container/VM, not the
 * `--role worker` drain process). Parsed from `docker inspect` JSON so an
 * attempt can be reproduced from digest + labels rather than a floating tag.
 */

export const DEFAULT_PI_AGENT_IMAGE = 'remote-sandbox-agents/pi-agent:local';

export const GUEST_IMAGE_KIND = 'pi-agent-guest';
export const GUEST_IMAGE_ENGINE = 'pi-agent';
export const GUEST_IMAGE_CONTRACT = 'runner-protocol-v1';

export const GUEST_IMAGE_LABELS = {
  kind: 'com.remote-sandbox-agents.kind',
  engine: 'com.remote-sandbox-agents.engine',
  contract: 'com.remote-sandbox-agents.contract',
  bundleSha256: 'com.remote-sandbox-agents.bundle-sha256',
  gitSha: 'com.remote-sandbox-agents.git-sha',
} as const;

export interface GuestImageIdentity {
  /** Requested repo:tag (e.g. remote-sandbox-agents/pi-agent:local). */
  name: string;
  /** Image id / digest (`sha256:…`), when inspect provided one. */
  digest: string | null;
  engine: string | null;
  kind: string | null;
  bundleSha256: string | null;
  gitSha: string | null;
  contract: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function label(labels: Record<string, unknown> | null, key: string): string | null {
  const v = labels?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function digestFromId(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  if (id.startsWith('sha256:')) return id;
  return `sha256:${id}`;
}

function digestFromRepoDigest(entry: unknown): string | null {
  if (typeof entry !== 'string') return null;
  const at = entry.lastIndexOf('@');
  if (at < 0) return null;
  const digest = entry.slice(at + 1);
  return digest.startsWith('sha256:') ? digest : null;
}

function firstString(arr: unknown): string | null {
  if (!Array.isArray(arr)) return null;
  const first = arr.find((v) => typeof v === 'string' && v.length > 0);
  return typeof first === 'string' ? first : null;
}

function parseInspectObject(obj: Record<string, unknown>): GuestImageIdentity | null {
  const config = asRecord(obj.Config);
  const labels = asRecord(config?.Labels ?? obj.Labels);
  const name = firstString(obj.RepoTags)
    ?? (typeof config?.Image === 'string' && config.Image.length > 0 ? config.Image : null)
    ?? (typeof obj.Name === 'string' ? obj.Name : null);
  if (!name) return null;

  const digest = digestFromId(typeof obj.Image === 'string' ? obj.Image : obj.Id)
    ?? digestFromRepoDigest(firstString(obj.RepoDigests));

  return {
    name,
    digest,
    engine: label(labels, GUEST_IMAGE_LABELS.engine),
    kind: label(labels, GUEST_IMAGE_LABELS.kind),
    bundleSha256: label(labels, GUEST_IMAGE_LABELS.bundleSha256),
    gitSha: label(labels, GUEST_IMAGE_LABELS.gitSha),
    contract: label(labels, GUEST_IMAGE_LABELS.contract),
  };
}

/** Parse `docker inspect` stdout (image or container). Returns null if unusable. */
export function parseDockerInspect(stdout: string): GuestImageIdentity | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const obj = Array.isArray(parsed) ? asRecord(parsed[0]) : asRecord(parsed);
  if (!obj) return null;
  return parseInspectObject(obj);
}

function emptyGuestIdentity(name: string): GuestImageIdentity {
  return {
    name,
    digest: null,
    engine: null,
    kind: null,
    bundleSha256: null,
    gitSha: null,
    contract: null,
  };
}

/** Inspect output when present; otherwise a name-only identity so create never fails. */
export function identityFromInspect(requestedName: string, inspectStdout: string): GuestImageIdentity {
  return parseDockerInspect(inspectStdout) ?? emptyGuestIdentity(requestedName);
}
