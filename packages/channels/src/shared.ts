import type { AgentBus, AgentBusPublishInput, SessionEventRecord } from '@remote-sandbox-agents/contracts';
import type { ChannelInput } from './channel.js';

/**
 * Build the canonical `channel.input` session event from a normalized
 * {@link ChannelInput}. Every channel emits the same event shape so the
 * orchestrator/worker engines have one ingestion path regardless of source.
 */
export function channelInputEvent(sessionId: string, input: ChannelInput): AgentBusPublishInput {
  return {
    sessionId,
    eventType: 'input',
    kind: 'channel.input',
    payload: { text: input.text, ...(input.payload ?? {}) },
  };
}

/** Publish a normalized {@link ChannelInput} onto the agent bus for a session. */
export function publishChannelInput(
  bus: AgentBus,
  sessionId: string,
  input: ChannelInput,
): Promise<SessionEventRecord> {
  return bus.publish(channelInputEvent(sessionId, input));
}
