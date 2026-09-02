/**
 * Canonical conversation key for the board channel: `board:v1:<project>:<task>`.
 * This is the linking key across worker and orchestrator sessions for a task
 * (used as `channel_origin`), and the identity helper every channel exposes
 * (spec §7). `projectId` must not contain ':'; `taskId` may be any non-empty string.
 */
export const BOARD_CHANNEL_VERSION = 'v1';

export function boardConversationKey(projectId: string, taskId: string): string {
  return `board:${BOARD_CHANNEL_VERSION}:${projectId}:${taskId}`;
}

export interface ParsedBoardKey {
  projectId: string;
  taskId: string;
}

const BOARD_KEY_RE = new RegExp(`^board:${BOARD_CHANNEL_VERSION}:([^:]+):(.+)$`);

/** Parse a board conversation key; returns null when it is not a board key. */
export function parseBoardConversationKey(key: string): ParsedBoardKey | null {
  const m = BOARD_KEY_RE.exec(key);
  if (!m) return null;
  return { projectId: m[1]!, taskId: m[2]! };
}
