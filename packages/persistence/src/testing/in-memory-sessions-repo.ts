import type { SessionRecord } from '@remote-sandbox-agents/contracts';
import {
  UniqueLiveSessionError,
  LIVE_SESSION_STATUSES,
  type ClaimRoutingOptions,
  type CreateSessionInput,
  type SessionsRepo,
} from '../sessions-repo.js';

export class InMemorySessionsRepo implements SessionsRepo {
  private readonly rows = new Map<string, SessionRecord>();

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    if (input.channelOrigin && input.actor === 'worker' && LIVE_SESSION_STATUSES.has(input.status)) {
      for (const existing of this.rows.values()) {
        if (
          existing.actor === 'worker' &&
          existing.channelOrigin === input.channelOrigin &&
          LIVE_SESSION_STATUSES.has(existing.status)
        ) {
          throw new UniqueLiveSessionError(input.channelOrigin);
        }
      }
    }
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: input.id, actor: input.actor, parentSessionId: input.parentSessionId,
      status: input.status as SessionRecord['status'], channelOrigin: input.channelOrigin,
      agentSpecId: input.agentSpecId, openedAt: now, closedAt: null, lastActivityAt: now,
      leaseExpiresAt: null, leaseOwner: null, leaseGeneration: 0, metadata: input.metadata,
    };
    this.rows.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<SessionRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async findByChannelOrigin(channelOrigin: string): Promise<SessionRecord | null> {
    let latest: SessionRecord | null = null;
    for (const r of this.rows.values()) {
      if (r.channelOrigin === channelOrigin) {
        if (!latest || r.openedAt > latest.openedAt) latest = r;
      }
    }
    return latest;
  }

  async listByActor(actor: 'orchestrator' | 'worker'): Promise<SessionRecord[]> {
    return Array.from(this.rows.values())
      .filter((r) => r.actor === actor)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    const closing = status === 'closed' || status === 'succeeded' || status === 'failed' || status === 'cancelled';
    const reopening = status === 'routing';
    const now = new Date().toISOString();
    this.rows.set(id, {
      ...r,
      status: status as SessionRecord['status'],
      lastActivityAt: now,
      closedAt: closing ? now : reopening ? null : r.closedAt,
      leaseExpiresAt: reopening ? null : r.leaseExpiresAt,
    });
  }

  async touchActivity(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    this.rows.set(id, { ...r, lastActivityAt: new Date().toISOString() });
  }

  async claimNextRouting(
    actor: 'worker',
    leaseExpiresAt: string,
    opts?: ClaimRoutingOptions,
  ): Promise<SessionRecord | null> {
    const next = Array.from(this.rows.values())
      .filter((r) => r.actor === actor && r.status === 'routing')
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt))[0];
    if (!next) return null;
    const claimed: SessionRecord = {
      ...next,
      status: 'running',
      lastActivityAt: new Date().toISOString(),
      leaseExpiresAt,
      leaseOwner: opts?.workerId ?? next.leaseOwner ?? null,
      leaseGeneration: (next.leaseGeneration ?? 0) + 1,
    };
    this.rows.set(claimed.id, claimed);
    return claimed;
  }

  async listExpiredRunning(actor: 'worker', now: string): Promise<SessionRecord[]> {
    return Array.from(this.rows.values())
      .filter((r) => r.actor === actor && r.status === 'running' && r.leaseExpiresAt != null && r.leaseExpiresAt < now)
      .sort((a, b) => (a.leaseExpiresAt ?? '').localeCompare(b.leaseExpiresAt ?? ''));
  }

  async mergeMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    this.rows.set(id, { ...r, metadata: { ...r.metadata, ...patch } });
  }

  async listPendingCompletion(): Promise<SessionRecord[]> {
    return Array.from(this.rows.values())
      .filter((r) =>
        (r.status === 'succeeded' || r.status === 'failed') &&
        r.metadata.completionPending != null &&
        r.metadata.completionProjectedAt == null,
      )
      .sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt));
  }
}
