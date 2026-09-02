export type AgentActor = 'orchestrator' | 'worker';
export type OrchestratorStatus = 'open' | 'closed';
export type WorkerStatus = 'routing' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface SessionRecord {
  id: string;
  actor: AgentActor;
  parentSessionId: string | null;
  status: OrchestratorStatus | WorkerStatus;
  channelOrigin: string | null;
  agentSpecId: string;
  openedAt: string;
  closedAt: string | null;
  lastActivityAt: string;
  /**
   * Worker-claim lease. Set when a worker session is atomically claimed
   * (status routing -> running); a session whose lease expires while still
   * `running` is presumed crashed and is failed by the lease sweep.
   */
  leaseExpiresAt?: string | null;
  /** Worker-service instance that currently holds the claim lease. */
  leaseOwner?: string | null;
  /** Monotonic generation incremented on every successful claim. */
  leaseGeneration?: number;
  metadata: Record<string, unknown>;
}

export interface SessionEventRecord {
  sessionId: string;
  eventIndex: number;
  eventType: 'input' | 'action' | 'turn' | 'system';
  kind: string;
  payload: unknown;
  createdAt: string;
}

export interface SessionSnapshot {
  session: SessionRecord;
  history: SessionEventRecord[];
}
