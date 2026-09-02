import type {
  AgentRunRecord,
  AgentRunSnapshotRefRow,
  AgentRunStatus,
  AgentRunsRepo,
  FinalizeAgentRunInput,
  MarkSandboxReadyInput,
  StartAgentRunInput,
} from '../agent-runs-repo.js';

export class InMemoryAgentRunsRepo implements AgentRunsRepo {
  private readonly rows = new Map<string, AgentRunRecord>();

  async start(input: StartAgentRunInput): Promise<AgentRunRecord> {
    const now = new Date().toISOString();
    const record: AgentRunRecord = {
      id: input.id,
      sessionId: input.sessionId,
      taskId: input.taskId ?? null,
      attemptNumber: input.attemptNumber,
      status: 'starting',
      agentSpecId: input.agentSpecId,
      backend: null,
      sandboxSessionId: null,
      containerId: null,
      workspaceLocation: null,
      startedAt: now,
      sandboxReadyAt: null,
      endedAt: null,
      durationMs: null,
      snapshotRef: null,
      summary: null,
      error: null,
      finishReason: null,
      tokenUsage: null,
      toolsUsed: null,
      guestImage: null,
      skillsUsed: null,
      artifacts: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(input.id, record);
    return record;
  }

  async markSandboxReady(input: MarkSandboxReadyInput): Promise<void> {
    const r = this.rows.get(input.id);
    if (!r) return;
    this.rows.set(input.id, {
      ...r,
      status: 'sandbox_ready',
      backend: input.backend,
      sandboxSessionId: input.sandboxSessionId,
      containerId: input.containerId ?? null,
      workspaceLocation: input.workspaceLocation ?? null,
      guestImage: input.guestImage ?? null,
      sandboxReadyAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async setStatus(id: string, status: AgentRunStatus): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    this.rows.set(id, { ...r, status, updatedAt: new Date().toISOString() });
  }

  async finalize(input: FinalizeAgentRunInput): Promise<void> {
    const r = this.rows.get(input.id);
    if (!r) return;
    this.rows.set(input.id, {
      ...r,
      status: input.status,
      endedAt: input.endedAt,
      durationMs: input.durationMs,
      snapshotRef: input.snapshotRef ?? null,
      summary: input.summary ?? null,
      error: input.error ?? null,
      finishReason: input.finishReason ?? null,
      tokenUsage: input.tokenUsage ?? null,
      toolsUsed: input.toolsUsed ?? null,
      skillsUsed: input.skillsUsed ?? null,
      artifacts: input.artifacts ?? null,
      updatedAt: new Date().toISOString(),
    });
  }

  async findById(id: string): Promise<AgentRunRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async listForSession(sessionId: string): Promise<AgentRunRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }

  async listForTask(taskId: string): Promise<AgentRunRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async listLive(): Promise<AgentRunRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.status !== 'succeeded' && r.status !== 'failed')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listSnapshotRefs(): Promise<AgentRunSnapshotRefRow[]> {
    const out: AgentRunSnapshotRefRow[] = [];
    for (const row of this.rows.values()) {
      const snapshotId = typeof row.snapshotRef?.id === 'string' ? row.snapshotRef.id : null;
      if (!snapshotId) continue;
      out.push({
        snapshotId,
        taskId: row.taskId,
        inFlight: row.status !== 'succeeded' && row.status !== 'failed',
        startedAt: row.startedAt,
      });
    }
    return out;
  }
}
