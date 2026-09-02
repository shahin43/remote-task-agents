import { normalizeSnapshotPath } from '@remote-sandbox-agents/sandbox';

export type BoardFileGroup = 'key' | 'artifacts' | 'git' | 'repo';

const KEY_FILES = new Set([
  'AGENTS.md',
  '.agent/handoff.json',
  '.agent/usage.json',
  '.agent/mr-request.json',
]);

const GIT_FILES = new Set(['git/changes.patch', 'git/branch.json']);

export function boardFileGroup(rawPath: string): BoardFileGroup | null {
  let normalized: string;
  try {
    normalized = normalizeSnapshotPath(rawPath);
  } catch {
    return null;
  }
  if (KEY_FILES.has(normalized)) return 'key';
  if (GIT_FILES.has(normalized)) return 'git';
  if (normalized === 'artifacts' || normalized.startsWith('artifacts/')) return 'artifacts';
  if (normalized === 'repo' || normalized.startsWith('repo/')) return 'repo';
  return null;
}

export function isBoardSnapshotPath(rawPath: string): boolean {
  return boardFileGroup(rawPath) !== null;
}

export function isArtifactsFile(rawPath: string): boolean {
  const group = boardFileGroup(rawPath);
  return group === 'artifacts' && rawPath !== 'artifacts' && !rawPath.endsWith('/');
}
