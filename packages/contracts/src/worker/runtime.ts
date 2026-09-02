import type { HandoffEnvelope } from './envelope.js';
import type { RunStatus } from '../common/types.js';
import type { ProviderActionRecord } from '../providers/board.js';

export interface RuntimeEvent {
  type: string;
  at: string;
  payload: unknown;
}

export interface WorkerResult {
  runId: string;
  status: RunStatus;
  summaryPath: string;
  eventLogPath: string;
  workspacePath: string;
  usedEngine: boolean;
  preflightOnly: boolean;
  engineKind?: string;
  threadId?: string;
  transcriptPath?: string;
  agentOutputPath?: string;
  providerActions?: ProviderActionRecord[];
}

export interface RuntimeHandle {
  readonly runId: string;
  events(): AsyncIterable<RuntimeEvent>;
  cancel(reason: string): Promise<void>;
  result(): Promise<WorkerResult>;
}

export interface WorkerRuntime {
  readonly kind: string;
  start(envelope: HandoffEnvelope): Promise<RuntimeHandle>;
}
