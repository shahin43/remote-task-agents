import type { ScopePolicy } from './scope.js';

export type WorkerRuntimeKind =
  | 'local'
  | 'docker'
  | 'remote'
  | 'sandbox-unix-local'
  | 'sandbox-docker';

/**
 * Identity of an in-tree engine. `pi-agent` runs the upstream
 * `@earendil-works/pi-coding-agent` SDK. Extra engines register at the
 * `AgentEngineRegistry` seam.
 */
export type WorkerEngineKind = 'pi-agent';
export type WorkspaceRetention = 'delete-on-success' | 'retain-for-inspection' | `retain-hours:${number}`;

export interface SkillSelector {
  mode: 'all' | 'tagged' | 'named';
  tags?: string[];
  names?: string[];
}

export interface WorkerProfile {
  id: string;
  runtime: WorkerRuntimeKind;
  engine: WorkerEngineKind;
  modelDefaults: {
    model: string;
    sandbox: string;
    approvalPolicy: string;
  };
  toolsets: string[];
  skills: SkillSelector;
  approvalPolicy: string;
  limits: {
    maxRuntimeMinutes: number;
    maxToolCalls: number;
  };
  workspaceRetention: WorkspaceRetention;
  /** Optional harness scope ceiling (D12). Absent ⇒ no narrowing policy enforced yet. */
  scopePolicy?: ScopePolicy;
  /**
   * Worker self-handoff capability (spec §5): when true, this worker profile may
   * chain to the next profile via the board `create_task`/`assign_task` tools
   * without an orchestrator. Absent/false ⇒ worker gets only the base subset
   * (`comment_task`, `update_status`).
   */
  canHandoff?: boolean;
  /** Extra Pi runner tool capabilities beyond the base set (e.g. `request_mr`). */
  capabilities?: string[];
}
