import { boardConversationKey, parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import type { Channel } from '../channel.js';

export interface BoardChannelParts {
  projectId: string;
  taskId: string;
}

/**
 * The board {@link Channel}: the canonical Kanban board is itself a channel, so
 * UI/API actions on tasks normalize through the same ingestion path as Slack /
 * API / Linear. Identity is the board conversation key `board:v1:<project>:<task>`
 * (defined once in `@remote-sandbox-agents/contracts`); this adapter just exposes it
 * behind the shared `Channel` port.
 */
export class BoardChannel implements Channel<BoardChannelParts> {
  readonly id = 'board';

  conversationKey(parts: BoardChannelParts): string {
    return boardConversationKey(parts.projectId, parts.taskId);
  }

  parseConversationKey(key: string): BoardChannelParts | null {
    return parseBoardConversationKey(key);
  }
}
