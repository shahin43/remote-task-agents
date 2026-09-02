import type { SessionEventRecord } from '@remote-sandbox-agents/contracts';

/**
 * A message in pi-ai conversation shape. Assistant messages persisted as
 * `turn/assistant_message` are passed through verbatim (opaque), so `content`
 * and any extra provider fields are preserved — prompt caching depends on a
 * byte-stable prefix, so we never re-derive these from text.
 */
export interface PiMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface SessionContext {
  /** Full conversation, with the latest input always last. */
  messages: PiMessage[];
  /** Text of the most recent input event — used by the engine's "nothing to do" guard. */
  currentInput: string | null;
}

/**
 * Reserved seam for future context transformations. Empty today; this is where
 * compaction settings and the memory-layer provider will hook in so that the
 * engine call site (`buildSessionContext(history, opts)`) does not change when
 * those features land. See the session-history-persistence design doc.
 */
export interface SessionContextOptions {
  /**
   * When false (default for worker follow-up replay), `action/tool_call.*` events
   * are omitted from the message list — only `channel.input` user turns and
   * `turn/assistant_message` are replayed. Standalone tool results from prior
   * worker runs are not valid OpenAI context without matching assistant toolCalls.
   */
  includeToolResults?: boolean;
}

/**
 * Reconstruct the full pi-ai conversation from a session's bus events.
 *
 * Event mapping (walked in eventIndex order):
 *   input/*                → { role: 'user', content: text }
 *   turn/assistant_message → raw pi-ai message (verbatim pass-through)
 *   action/tool_call.*     → { role: 'toolResult', ... } when includeToolResults (orchestrator)
 *
 * Invariant: the last message is the most recent input event, so the LLM sees
 * it as the current question and everything prior as context.
 */
export function buildSessionContext(
  history: SessionEventRecord[],
  opts?: SessionContextOptions,
): SessionContext {
  const includeToolResults = opts?.includeToolResults ?? true;
  const messages: PiMessage[] = [];
  let currentInput: string | null = null;

  // Find the index of the last input event so we can flag its text.
  let lastInputIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.eventType === 'input') {
      lastInputIndex = i;
      break;
    }
  }

  for (let i = 0; i < history.length; i++) {
    const e = history[i]!;

    if (e.eventType === 'input') {
      const text = inputToText(e.kind, e.payload);
      if (text) {
        if (i === lastInputIndex) currentInput = text;
        messages.push({ role: 'user', content: text });
      }
    } else if (e.eventType === 'turn' && e.kind === 'assistant_message') {
      // Opaque pass-through — preserves byte-stable prefix for prompt caching.
      messages.push(e.payload as PiMessage);
    } else if (includeToolResults && e.eventType === 'action' && e.kind.startsWith('tool_call.')) {
      const payload = e.payload as {
        callId: string;
        name: string;
        args: unknown;
        result?: { success?: boolean; output?: string };
      };
      messages.push({
        role: 'toolResult',
        toolCallId: payload.callId,
        toolName: payload.name,
        content: [{ type: 'text', text: payload.result?.output ?? '' }],
        isError: !(payload.result?.success ?? true),
      });
    }
    // turn/final_message (legacy, pre-assistant_message) is intentionally
    // ignored: the canonical assistant content now lives in assistant_message.
  }

  return { messages, currentInput };
}

function inputToText(kind: string, payload: unknown): string | null {
  if (kind === 'channel.input') {
    const p = payload as { text?: string; ticket?: { title?: string; description?: string } };
    if (p.text) return p.text;
    if (p.ticket) return `${p.ticket.title ?? ''}\n\n${p.ticket.description ?? ''}`.trim();
  }
  if (kind === 'run.summary') {
    const p = payload as { text?: string };
    if (p.text) return p.text;
  }
  if (kind === 'child_session_completed') {
    const p = payload as {
      childId: string;
      summary?: string;
      status?: string;
      toolsUsed?: string[];
      filesChanged?: string[];
      turnsUsed?: number;
    };
    let text = `Worker session ${p.childId} finished: status=${p.status ?? 'unknown'}`;
    if (p.summary) text += `\nSummary: ${p.summary}`;
    if (p.toolsUsed?.length) text += `\nTools used: ${p.toolsUsed.join(', ')}`;
    if (p.filesChanged?.length) text += `\nFiles changed: ${p.filesChanged.join(', ')}`;
    if (p.turnsUsed) text += `\nTurns: ${p.turnsUsed}`;
    return text;
  }
  return null;
}
