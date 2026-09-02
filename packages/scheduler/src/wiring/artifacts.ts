import { normalizeSnapshotPath } from '@remote-sandbox-agents/sandbox';

export interface CapturedArtifact {
  path: string;
  title: string;
  primary: boolean;
  declared: boolean;
}

export interface ArtifactDrop {
  path: string;
  reason: 'not_under_artifacts' | 'missing' | 'cap' | 'malformed';
}

export interface ResolveArtifactsResult {
  kept: CapturedArtifact[];
  dropped: ArtifactDrop[];
  /** true when we invented the list from snapshotPaths because no sidecar object was present */
  derived: boolean;
}

const DEFAULT_MAX_ENTRIES = 32;
const TITLE_MAX = 200;

export function readArtifactsMaxEntries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES;
  if (!raw) return DEFAULT_MAX_ENTRIES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_ENTRIES;
  return parsed;
}

function normalizeMaxEntries(maxEntries: number | undefined): number {
  if (typeof maxEntries !== 'number' || !Number.isFinite(maxEntries) || maxEntries < 1) {
    return DEFAULT_MAX_ENTRIES;
  }
  return Math.floor(maxEntries);
}

function isArtifactFilePath(normalized: string): boolean {
  return normalized.startsWith('artifacts/') && normalized !== 'artifacts/' && !normalized.endsWith('/');
}

function titleFrom(raw: unknown, path: string): string {
  if (typeof raw === 'string') {
    const t = raw.trim().slice(0, TITLE_MAX);
    if (t.length > 0) return t;
  }
  return path.split('/').pop() ?? path;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function looksLikePathEntry(item: unknown): boolean {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item) && 'path' in (item as object));
}

function missingJsonClosers(raw: string): string | undefined {
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (const ch of raw) {
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] !== ch) return undefined;
      stack.pop();
    }
  }
  if (inString || stack.length === 0) return undefined;
  return stack.reverse().join('');
}

function repairTruncatedJson(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const closers = missingJsonClosers(trimmed);
  if (!closers) return undefined;
  try { return JSON.parse(trimmed + closers); } catch { return undefined; }
}

/**
 * Agents sometimes write `previewDeliverables` or a top-level array instead of
 * `{ "artifacts": [...] }`. Accept those shapes as declared; `{}` and an explicit
 * empty `artifacts` array still mean "nothing to preview".
 */
function declaredEntryList(declared: unknown): unknown[] | 'derive' | 'empty' {
  if (Array.isArray(declared)) return declared;
  if (!isPlainObject(declared)) return 'derive';
  if (declared.__invalidJson === true) {
    const repaired = typeof declared.raw === 'string' ? repairTruncatedJson(declared.raw) : undefined;
    if (repaired !== undefined) return declaredEntryList(repaired);
    return 'derive';
  }
  if (Array.isArray(declared.artifacts)) return declared.artifacts;
  for (const value of Object.values(declared)) {
    if (Array.isArray(value) && value.some(looksLikePathEntry)) return value;
  }
  return 'empty';
}

function snapshotArtifactFiles(snapshotPaths: string[], opts?: { includeHarnessSummary?: boolean }): string[] {
  const out = new Set<string>();
  for (const raw of snapshotPaths) {
    try {
      const normalized = normalizeSnapshotPath(raw);
      if (!isArtifactFilePath(normalized)) continue;
      if (!opts?.includeHarnessSummary && normalized === 'artifacts/summary.md') continue;
      out.add(normalized);
    } catch {
      // Ignore malformed snapshot entries.
    }
  }
  return [...out].sort();
}

function derive(snapshotPaths: string[], maxEntries: number): ResolveArtifactsResult {
  const files = snapshotArtifactFiles(snapshotPaths);
  const keptPaths = files.slice(0, maxEntries);
  const dropped: ArtifactDrop[] = files.slice(maxEntries).map((path) => ({ path, reason: 'cap' as const }));
  const primaryPath = keptPaths.find((path) => path.endsWith('.md')) ?? keptPaths[0];
  const kept = keptPaths.map((path) => ({
    path,
    title: titleFrom(undefined, path),
    primary: path === primaryPath,
    declared: false,
  }));
  return { kept, dropped, derived: true };
}

export function resolveArtifacts(input: {
  declared: unknown;
  snapshotPaths: string[];
  maxEntries?: number;
}): ResolveArtifactsResult {
  const maxEntries = normalizeMaxEntries(input.maxEntries);
  const entries = declaredEntryList(input.declared);
  if (entries === 'derive') return derive(input.snapshotPaths, maxEntries);
  if (entries === 'empty') {
    return {
      kept: [],
      dropped: [{ path: '', reason: 'malformed' }],
      derived: false,
    };
  }

  const existing = new Set(snapshotArtifactFiles(input.snapshotPaths, { includeHarnessSummary: true }));
  const kept: CapturedArtifact[] = [];
  const dropped: ArtifactDrop[] = [];
  let primaryAssigned = false;

  for (const item of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dropped.push({ path: '', reason: 'malformed' });
      continue;
    }

    const rec = item as { path?: unknown; title?: unknown; primary?: unknown };
    if (typeof rec.path !== 'string') {
      dropped.push({ path: String(rec.path ?? ''), reason: 'malformed' });
      continue;
    }

    let normalized: string;
    try {
      normalized = normalizeSnapshotPath(rec.path);
    } catch {
      dropped.push({ path: rec.path, reason: 'not_under_artifacts' });
      continue;
    }

    if (!isArtifactFilePath(normalized)) {
      dropped.push({ path: rec.path, reason: 'not_under_artifacts' });
      continue;
    }

    if (!existing.has(normalized)) {
      dropped.push({ path: rec.path, reason: 'missing' });
      continue;
    }

    if (kept.length >= maxEntries) {
      dropped.push({ path: normalized, reason: 'cap' });
      continue;
    }

    const primary = rec.primary === true && !primaryAssigned;
    if (rec.primary === true) primaryAssigned = true;
    kept.push({
      path: normalized,
      title: titleFrom(rec.title, normalized),
      primary,
      declared: true,
    });
  }

  if (kept.length > 0 && !kept.some((artifact) => artifact.primary)) {
    kept[0]!.primary = true;
  }

  return { kept, dropped, derived: false };
}
