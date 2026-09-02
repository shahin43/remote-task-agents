import type {
  AgentEngine,
  AgentEngineInput,
  AgentTurnResult,
  ToolScope,
} from '@remote-sandbox-agents/contracts';
import { buildSessionContext } from './session.js';
import { runPiLoop } from './loop.js';

export interface PiEngineOptions {
  provider: string;
  model: string;
  maxTurns?: number;
  /**
   * When true, ask the provider to retain requests server-side (OpenAI
   * `store: true`) so they appear in the platform Logs dashboard. pi-ai
   * defaults to `store: false` (privacy-by-default for a coding agent), so
   * this is opt-in and intended for debugging. Off by default.
   */
  storeRequests?: boolean;
  // Allow tests to inject a fake pi-ai module.
  piAi?: PiAiLike;
}

export interface PiAiModel {
  id: string;
  provider: string;
  [key: string]: unknown;
}

export interface PiAiToolCall {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface PiAiMessage {
  role: string;
  content: Array<{ type: string; text?: string } | PiAiToolCall>;
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; cost?: { total: number } };
  [key: string]: unknown;
}

export interface PiAiContext {
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
}

export interface PiAiStreamEvent {
  type: string;
  delta?: string;
  toolCall?: PiAiToolCall;
  /** pi-ai may emit a string or an object with `errorMessage`. */
  error?: unknown;
  [key: string]: unknown;
}

export interface PiAiStream {
  [Symbol.asyncIterator](): AsyncIterator<PiAiStreamEvent>;
  result(): Promise<PiAiMessage>;
}

export interface PiAiStreamOptions {
  /**
   * Inspect or replace the provider request payload before it is sent.
   * Return the (mutated) payload to override, or undefined to leave unchanged.
   */
  onPayload?: (payload: unknown, model: PiAiModel) => unknown | undefined;
  [key: string]: unknown;
}

export interface PiAiLike {
  getModel(provider: string, id: string): PiAiModel;
  stream(model: PiAiModel, context: PiAiContext, options?: PiAiStreamOptions): PiAiStream;
  Type: {
    Object(props: Record<string, unknown>): unknown;
    String(opts?: Record<string, unknown>): unknown;
    Optional(schema: unknown): unknown;
  };
}

export class PiCodingAgentEngine implements AgentEngine {
  readonly kind = 'pi-agent';
  constructor(private readonly opts: PiEngineOptions) {}

  async runTurn(input: AgentEngineInput): Promise<AgentTurnResult> {
    const piAi = this.opts.piAi ?? (await import('@earendil-works/pi-ai') as unknown as PiAiLike);
    const sessionContext = buildSessionContext(input.session.history);
    if (!sessionContext.currentInput) {
      return { toolCalls: [], finishReason: 'completed' };
    }

    const systemPrompt = (await input.spec.prompt.assemble(input.session)).system;
    const maxTurns = this.opts.maxTurns ?? input.spec.policies.maxTurns ?? 5;

    // Build pi-ai compatible tool definitions from our ToolProvider, scoped by
    // the spec's actor so the same engine serves orchestrator and worker specs.
    const scope: ToolScope = input.spec.actor === 'worker' ? 'worker' : 'orchestrator';
    const toolDefs = input.spec.tools.list(scope).map((desc) => ({
      name: desc.name,
      description: desc.schema.description ? String(desc.schema.description) : desc.name,
      parameters: desc.schema,
    }));

    // Tools execute against the spec's filesystem root (the sandbox/local
    // workspace). Falls back to '/dev/null' for specs with no filesystem root
    // (e.g. the orchestrator, whose tools are session-scoped, not file-scoped).
    const workspacePath = input.spec.fs?.root ?? '/dev/null';

    // Conversation context from the full replayed history (latest input last),
    // with a defensive single-message fallback if replay produced nothing.
    const messages = sessionContext.messages.length > 0
      ? sessionContext.messages
      : [{ role: 'user', content: sessionContext.currentInput }];

    return runPiLoop({
      piAi,
      provider: this.opts.provider,
      model: this.opts.model,
      systemPrompt,
      messages,
      toolDefs,
      maxTurns,
      signal: input.signal,
      storeRequests: this.opts.storeRequests,
      invokeTool: (name, args) =>
        input.spec.tools.invoke(name, args, {
          runId: input.session.session.id,
          profileId: input.spec.id,
          workspacePath,
        }),
    });
  }
}
