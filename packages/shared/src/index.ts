export type {
  TaskSource,
  TaskIntent,
  WriteMode,
  RunStatus,
  RunRecord,
} from '@remote-sandbox-agents/contracts';
export type { RemoteAgentTask } from '@remote-sandbox-agents/contracts';

export type engineApprovalPolicy = 'never' | 'on-request' | 'untrusted';
export type engineSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';
export type engineAuthMode = 'apiKey' | 'mounted' | 'auto';
export type ContextTrustLevel = 'trusted' | 'untrusted';
export type WorkerStatus = 'starting' | 'idle' | 'claimed' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface engineRuntimeConfig {
  model?: string;
  approvalPolicy?: engineApprovalPolicy;
  sandbox?: engineSandbox;
}

export interface WorkerInput {
  task: import('@remote-sandbox-agents/contracts').RemoteAgentTask;
  repoPath: string;
  workspaceRoot: string;
  runsRoot: string;
  artifactsRoot: string;
  dryRun: boolean;
  preflightOnly?: boolean;
  authMode?: engineAuthMode;
  attempt?: number;
  runContract?: AgentRunContract;
}

export interface WorkerResult {
  run: import('@remote-sandbox-agents/contracts').RunRecord;
  summaryPath: string;
  eventLogPath: string;
  workspacePath: string;
  usedengineAppServer: boolean;
  preflightOnly: boolean;
  authMode?: ResolvedAuthMode;
  engineVersion?: string;
  runtimeUsed?: ResolvedRuntime;
  transcriptPath?: string;
  agentOutputPath?: string;
  threadId?: string;
  providerActions?: ProviderActionRecord[];
}

export interface ResolvedRuntime {
  model: string;
  approvalPolicy: engineApprovalPolicy;
  sandbox: engineSandbox;
}

export type ResolvedAuthMode = 'apiKey' | 'mounted';

export interface ContextFile {
  relativePath: string;
  source: string;
  sourceUrl?: string;
  trustLevel: ContextTrustLevel;
  content: string;
}

export interface AgentSkillRef {
  name: string;
  source: 'service' | 'repo' | 'tenant';
  path?: string;
  description?: string;
  enabled: boolean;
}

export interface AgentRunContract {
  contractVersion: 'v1';
  generatedAt: string;
  agentProfile: string;
  task: import('@remote-sandbox-agents/contracts').RemoteAgentTask;
  repo: {
    provider: 'local' | 'local';
    projectId: string;
    baseBranch: string;
    targetPaths: string[];
    resolvedLocalPath: string;
    workflowPath: string;
    credentialRefs: {
      read?: string;
      write?: string;
    };
  };
  contextFiles: ContextFile[];
  skills: AgentSkillRef[];
  memory: {
    summaries: ContextFile[];
  };
  gateways?: GatewayProviderRef[];
  policy: {
    writeMode: import('@remote-sandbox-agents/contracts').WriteMode;
    approvalMode: string;
    networkProfile: string;
    requiresHumanApproval: boolean;
  };
}

export interface GatewayProviderRef {
  kind: 'board' | 'repo' | 'channel';
  provider: string;
  mode: 'noop' | 'local' | 'api';
  configured: boolean;
  credentialRefs: string[];
  workerAllowedActions: string[];
  notes?: string[];
}

export interface ProviderActionRecord {
  kind: 'board' | 'repo' | 'channel';
  provider: string;
  action: string;
  status: 'succeeded' | 'skipped' | 'failed';
  message: string;
  externalId?: string;
  externalUrl?: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeRunId(taskKey: string, attempt = 1): string {
  const normalized = taskKey.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  return `${normalized}-attempt-${attempt}`;
}

export function addMinutes(date: Date, minutes: number): string {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

export function assertRemoteAgentTask(value: unknown): asserts value is import('@remote-sandbox-agents/contracts').RemoteAgentTask {
  if (!value || typeof value !== 'object') {
    throw new Error('Task payload must be an object.');
  }

  const task = value as Partial<import('@remote-sandbox-agents/contracts').RemoteAgentTask>;
  const required = [
    ['taskId', task.taskId],
    ['source', task.source],
    ['intent', task.intent],
    ['repo', task.repo],
    ['workItem', task.workItem],
    ['workflow', task.workflow],
    ['constraints', task.constraints],
    ['idempotency', task.idempotency],
    ['prompt', task.prompt],
  ];

  for (const [name, field] of required) {
    if (field === undefined || field === null || field === '') {
      throw new Error(`Task payload is missing ${name}.`);
    }
  }
}
