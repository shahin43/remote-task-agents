import type { RemoteAgentTask } from '../gateway/gateway.js';
import type { RunRecord } from '../common/types.js';
import type { ProviderDescriptor, ProviderActionRecord } from './board.js';

export interface ChannelProviderAdapter {
  descriptor(): ProviderDescriptor;
  notifyRunStatus(task: RemoteAgentTask, run: RunRecord, body: string): Promise<ProviderActionRecord>;
}
