/**
 * A normalized inbound message produced by any channel. Channels translate a
 * verified provider-native event (board action, Slack mention, API call, Linear
 * webhook) into this shape; the control plane then seeds it as the session's
 * `channel.input` event (spec §7).
 */
export interface ChannelInput {
  /** Canonical conversation key, e.g. `board:v1:<project>:<task>`. */
  conversationKey: string;
  /** Free-text prompt seeded as the session's current input. */
  text: string;
  /** Extra structured fields merged into the `channel.input` payload. */
  payload?: Record<string, unknown>;
}

/**
 * The Channel port: a verified ingress that maps provider-native identity to a
 * canonical, namespaced conversation key and back. This is the shared contract
 * every channel (board, slack, api, linear) implements; behavior common to all
 * channels lives in `./shared`. `Parts` is the channel's native identity shape
 * (for the board: `{ projectId, taskId }`).
 */
export interface Channel<Parts = Record<string, string>> {
  readonly id: string;
  /** Provider-native identity → canonical conversation key. */
  conversationKey(parts: Parts): string;
  /** Canonical key → parsed parts, or `null` when the key is not this channel's. */
  parseConversationKey(key: string): Parts | null;
}
