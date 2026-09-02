export type TaskSource = 'linear' | 'jira' | 'git' | 'slack' | 'api';
export type TaskIntent = 'triage' | 'implement' | 'review' | 'investigate' | 'summarize';
export type WriteMode = 'report-only' | 'draft-mr';
export type RunStatus =
  | 'eligible'
  | 'claimed'
  | 'queued'
  | 'running'
  | 'blocked_approval'
  | 'retry_queued'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'released';

export interface RunRecord {
  runId: string;
  taskKey: string;
  attempt: number;
  status: RunStatus;
  claimOwner: string;
  leaseExpiresAt: string;
  lastHeartbeatAt: string;
  policyVersion: string;
  branchName: string;
  providerIds: Record<string, string>;
  startedAt: string;
  completedAt?: string;
  summary?: string;
}
