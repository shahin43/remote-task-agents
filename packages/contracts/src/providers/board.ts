import type { RemoteAgentTask } from '../gateway/gateway.js';
import type { RunRecord } from '../common/types.js';

export interface ProviderDescriptor {
  kind: 'board' | 'repo' | 'channel';
  provider: string;
  mode: 'noop' | 'local' | 'api';
  configured: boolean;
  credentialRefs: string[];
  allowedActions: string[];
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

export interface BoardProviderAdapter {
  descriptor(): ProviderDescriptor;
  updateRunStatus(task: RemoteAgentTask, run: RunRecord): Promise<ProviderActionRecord>;
  appendRunComment(task: RemoteAgentTask, body: string): Promise<ProviderActionRecord>;
}
