import type { HandoffEnvelope } from './envelope.js';

export interface EventSink {
  emit(type: string, payload: unknown): Promise<void>;
}

export interface EngineResult {
  summary: string;
  threadId?: string;
  transcriptPath?: string;
  agentOutputPath?: string;
}

export interface WorkerEngine {
  readonly kind: string;
  run(envelope: HandoffEnvelope, sink: EventSink, signal: AbortSignal): Promise<EngineResult>;
}
