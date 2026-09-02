import type { AgentTurnResult, ToolCallRecord, TokenUsage } from '@remote-sandbox-agents/contracts';
import type { PiAiLike, PiAiToolCall, PiAiStreamOptions } from './pi-engine.js';

/** A pi-ai compatible tool definition (name + JSON-schema-ish parameters). */
export interface PiToolDef {
  name: string;
  description: string;
  parameters: unknown;
}

/** Result of executing a single tool call. */
export interface PiToolResult {
  success: boolean;
  output: string;
}

/** An event surfaced from inside the loop (one per executed tool call). */
export interface PiLoopEvent {
  type: 'tool_call';
  data: ToolCallRecord;
}

export interface RunPiLoopInput {
  piAi: PiAiLike;
  provider: string;
  model: string;
  systemPrompt: string;
  /** Full conversation, latest input last. Must be non-empty. */
  messages: unknown[];
  toolDefs: PiToolDef[];
  /** Execute a tool call. The caller decides where/how (in-process or in-sandbox). */
  invokeTool: (name: string, args: Record<string, unknown>) => Promise<PiToolResult>;
  maxTurns: number;
  signal: AbortSignal;
  storeRequests?: boolean;
  /** Optional observer, called once per executed tool call. */
  onEvent?: (event: PiLoopEvent) => void;
}

export interface RunPiLoopResult {
  toolCalls: ToolCallRecord[];
  finalMessage?: string;
  finishReason: AgentTurnResult['finishReason'];
  errorMessage?: string;
  usage?: TokenUsage;
  /** Messages produced during this run (assistant + toolResult), after the replayed prefix. */
  rawMessages: unknown[];
}

/** Normalize pi-ai stream errors (often objects with `errorMessage`) for logs/UI. */
export function formatStreamError(error: unknown): string {
  if (error == null) return 'unknown stream error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.errorMessage === 'string' && obj.errorMessage) return obj.errorMessage;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * The shared pi turn loop. Pure of session/persistence concerns: it streams
 * model turns, executes tool calls via the injected `invokeTool`, and returns a
 * normalized result. Used both by `PiCodingAgentEngine` (host-side, tools via a
 * ToolProvider) and by the in-container `pi-runner` (tools via local FS/shell).
 */
export async function runPiLoop(input: RunPiLoopInput): Promise<RunPiLoopResult> {
  const model = input.piAi.getModel(input.provider, input.model);

  const streamOptions: PiAiStreamOptions | undefined = input.storeRequests
    ? {
        onPayload: (payload) => {
          if (payload && typeof payload === 'object') {
            (payload as Record<string, unknown>).store = true;
          }
          return payload;
        },
      }
    : undefined;

  const context = {
    systemPrompt: input.systemPrompt,
    messages: [...input.messages],
    tools: input.toolDefs,
  };
  const replayedCount = context.messages.length;

  const allToolCalls: ToolCallRecord[] = [];
  let finalMessage: string | undefined;
  let finishReason: AgentTurnResult['finishReason'] = 'completed';
  let errorMessage: string | undefined;
  let usage: TokenUsage | undefined;
  let turn = 0;

  try {
    while (turn < input.maxTurns) {
      if (input.signal.aborted) {
        finishReason = 'aborted';
        break;
      }
      turn++;
      const s = input.piAi.stream(model, context, streamOptions);
      let turnText = '';

      for await (const event of s) {
        if (input.signal.aborted) break;
        if (event.type === 'text_delta' && event.delta) {
          turnText += event.delta;
        } else if (event.type === 'toolcall_end' && event.toolCall) {
          const call = event.toolCall;
          const startedAt = new Date().toISOString();
          const result = await input.invokeTool(call.name, call.arguments);
          const endedAt = new Date().toISOString();
          const record: ToolCallRecord = {
            callId: call.id,
            name: call.name,
            args: call.arguments,
            result,
            startedAt,
            endedAt,
          };
          allToolCalls.push(record);
          input.onEvent?.({ type: 'tool_call', data: record });
        } else if (event.type === 'error') {
          finishReason = 'error';
          errorMessage = formatStreamError(event.error);
        }
      }

      const msg = await s.result();
      context.messages.push(msg);

      if (msg.usage) {
        usage = {
          inputTokens: (usage?.inputTokens ?? 0) + (msg.usage.input ?? 0),
          outputTokens: (usage?.outputTokens ?? 0) + (msg.usage.output ?? 0),
          cacheReadTokens: (usage?.cacheReadTokens ?? 0) + (msg.usage.cacheRead ?? 0),
          cacheWriteTokens: (usage?.cacheWriteTokens ?? 0) + (msg.usage.cacheWrite ?? 0),
        };
      }

      if (turnText) finalMessage = (finalMessage ?? '') + turnText;

      const toolCallBlocks = msg.content.filter(
        (b): b is PiAiToolCall => (b as { type?: string }).type === 'toolCall',
      );

      if (toolCallBlocks.length === 0) break;

      for (const call of toolCallBlocks) {
        const executed = allToolCalls.find((tc) => tc.callId === call.id);
        context.messages.push({
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: executed?.result.output ?? '' }],
          isError: !(executed?.result.success ?? true),
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    finishReason = input.signal.aborted ? 'aborted' : 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (finishReason === 'completed' && allToolCalls.length > 0 && !finalMessage) {
    finishReason = 'tool_call_only';
  }

  const rawMessages = context.messages.slice(replayedCount);

  return { toolCalls: allToolCalls, finalMessage, finishReason, errorMessage, usage, rawMessages };
}
