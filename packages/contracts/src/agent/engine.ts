import type { AgentSpec } from './spec.js';
import type { SessionSnapshot } from './session.js';
import type { AgentBus } from './bus.js';

export interface AgentEngineInput {
  spec: AgentSpec;
  session: SessionSnapshot;
  bus: AgentBus;
  signal: AbortSignal;
}

export interface ToolCallRecord {
  callId: string;
  name: string;
  args: unknown;
  result: { success: boolean; output: string; error?: string };
  startedAt: string;
  endedAt: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type FinishReason = 'completed' | 'tool_call_only' | 'aborted' | 'error';

export interface AgentTurnResult {
  toolCalls: ToolCallRecord[];
  finalMessage?: string;
  usage?: TokenUsage;
  finishReason: FinishReason;
  errorMessage?: string;
  /**
   * Raw provider (pi-ai) messages produced during this turn, in conversation
   * order: assistant messages and toolResult messages as they occurred. The
   * runner persists these to the session bus for history replay and prompt
   * caching. Treated as opaque pass-through — never re-derived from finalMessage.
   */
  rawMessages?: unknown[];
  /**
   * Opt-in handoff intent emitted by the worker (typically via the
   * `handoff` Pi tool). The harness parses + validates this against the
   * board after the run; the engine itself never touches the board.
   * Kept as `unknown` so the contracts package stays free of board
   * concerns.
   */
  handoff?: unknown;
  /**
   * Opt-in MR promotion request emitted by the worker via the `request_mr`
   * Pi tool. Parsed + validated by the harness; push/MR side effects stay
   * outside the sandbox.
   */
  mrRequest?: unknown;
  /**
   * Opt-in artifact declaration emitted by the worker via the artifacts sidecar.
   * Parsed + resolved by the harness against captured workspace files.
   */
  artifacts?: unknown;
}

export interface AgentEngine {
  readonly kind: string;
  runTurn(input: AgentEngineInput): Promise<AgentTurnResult>;
}
