import type { TaskSource, TaskIntent, WriteMode } from '../common/types.js';

export interface RemoteAgentTask {
  taskId: string;
  source: TaskSource;
  intent: TaskIntent;
  repo: {
    provider: 'local' | 'local';
    projectId: string;
    baseBranch: string;
    targetPaths: string[];
  };
  workItem: {
    type: TaskSource;
    key: string;
    url?: string;
    title: string;
    description: string;
  };
  workflow: {
    path: string;
    handoffState: string;
  };
  constraints: {
    maxRuntimeMinutes: number;
    networkProfile: string;
    writeMode: WriteMode;
    requiresHumanApproval: boolean;
  };
  idempotency: {
    runKey: string;
    branchName: string;
  };
  runtime?: {
    model?: string;
    approvalPolicy?: 'never' | 'on-request' | 'untrusted';
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  };
  prompt: string;
}

export interface SubmitContext {
  submittedBy: string;
  submittedAt: string;
  channelKind: string;
}

export interface SubmitReceipt {
  taskKey: string;
  status: 'accepted' | 'duplicate';
  runKey: string;
}

export interface Gateway {
  submit(task: RemoteAgentTask, ctx: SubmitContext): Promise<SubmitReceipt>;
  cancel(taskKey: string, reason: string, actor: string): Promise<{ status: 'cancelled' | 'in-flight' | 'not-found' }>;
}

export interface OpenSessionInput {
  channelOrigin: string;
  agentSpecId: string;
  metadata?: Record<string, unknown>;
}

export interface OpenSessionResult {
  sessionId: string;
  created: boolean;
}

export interface AppendInputResult {
  eventIndex: number;
}

export interface SessionGateway {
  openSession(input: OpenSessionInput): Promise<OpenSessionResult>;
  appendInput(sessionId: string, kind: string, payload: unknown): Promise<AppendInputResult>;
}
