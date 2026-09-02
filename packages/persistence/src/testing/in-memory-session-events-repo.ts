import type { SessionEventRecord } from '@remote-sandbox-agents/contracts';
import type { AppendEventInput, SessionEventsRepo } from '../session-events-repo.js';

export class InMemorySessionEventsRepo implements SessionEventsRepo {
  private readonly rows: SessionEventRecord[] = [];

  async append(input: AppendEventInput): Promise<SessionEventRecord> {
    const sessionRows = this.rows.filter((r) => r.sessionId === input.sessionId);
    const nextIndex = sessionRows.length === 0
      ? 0
      : Math.max(...sessionRows.map((r) => r.eventIndex)) + 1;
    const record: SessionEventRecord = {
      sessionId: input.sessionId,
      eventIndex: nextIndex,
      eventType: input.eventType,
      kind: input.kind,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };
    this.rows.push(record);
    return record;
  }

  async list(sessionId: string, fromIndex = 0): Promise<SessionEventRecord[]> {
    return this.rows
      .filter((r) => r.sessionId === sessionId && r.eventIndex >= fromIndex)
      .sort((a, b) => a.eventIndex - b.eventIndex);
  }

  async fetchByIndex(sessionId: string, eventIndex: number): Promise<SessionEventRecord | null> {
    return this.rows.find((r) => r.sessionId === sessionId && r.eventIndex === eventIndex) ?? null;
  }
}
