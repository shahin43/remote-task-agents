import type { RemoteAgentTask } from '../gateway/gateway.js';
import type { RunRecord } from '../common/types.js';
import type { ProviderDescriptor, ProviderActionRecord } from './board.js';

export interface DraftMergeRequestInput {
  task: RemoteAgentTask;
  run: RunRecord;
  workspacePath: string;
  title: string;
  description: string;
}

export interface RepoProviderAdapter {
  descriptor(): ProviderDescriptor;
  publishDraftMergeRequest(input: DraftMergeRequestInput): Promise<ProviderActionRecord>;
}
