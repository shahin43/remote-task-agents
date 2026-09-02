import type { AgentSpec } from './spec.js';
import type { SessionSnapshot } from './session.js';
import type { WorkspaceRetention } from '../orchestrator/profile.js';

export type WorkspaceKind = 'none' | 'local' | 'docker' | 'remote';

export interface WorkspaceHandle {
  path?: string;
  cleanupHints: { retention: WorkspaceRetention };
  metadata: Record<string, string>;
}

export interface WorkspaceProvider {
  readonly kind: WorkspaceKind;
  prepare(spec: AgentSpec, session: SessionSnapshot): Promise<WorkspaceHandle>;
  cleanup(handle: WorkspaceHandle, outcome: 'succeeded' | 'failed' | 'cancelled'): Promise<void>;
}
