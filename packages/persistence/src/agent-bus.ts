import type { AgentBus, AgentBusPublishInput, SessionEventRecord, Unsubscribe } from '@remote-sandbox-agents/contracts';
import type { SessionEventsRepo } from './session-events-repo.js';

export class InMemoryAgentBus implements AgentBus {
  private readonly subs = new Map<string, Set<(e: SessionEventRecord) => void>>();
  constructor(private readonly events: SessionEventsRepo) {}

  async publish(event: AgentBusPublishInput): Promise<SessionEventRecord> {
    const record = await this.events.append(event);
    const handlers = this.subs.get(record.sessionId);
    if (handlers) for (const h of handlers) h(record);
    return record;
  }

  async subscribe(sessionId: string, handler: (e: SessionEventRecord) => void): Promise<Unsubscribe> {
    if (!this.subs.has(sessionId)) this.subs.set(sessionId, new Set());
    this.subs.get(sessionId)!.add(handler);
    return async () => {
      this.subs.get(sessionId)?.delete(handler);
    };
  }

  async *replay(sessionId: string, fromIndex = 0): AsyncIterable<SessionEventRecord> {
    for (const r of await this.events.list(sessionId, fromIndex)) yield r;
  }
}

import pg from 'pg';

export interface PostgresAgentBusOptions {
  connectionString: string;
  events: SessionEventsRepo;
}

export class PostgresAgentBus implements AgentBus {
  private readonly listener: pg.Client;
  private readonly subs = new Map<string, Set<(e: SessionEventRecord) => void>>();
  private connected = false;

  constructor(private readonly opts: PostgresAgentBusOptions) {
    this.listener = new pg.Client({ connectionString: opts.connectionString });
    this.listener.on('notification', async (msg) => {
      if (!msg.channel.startsWith('session_')) return;
      const sessionId = msg.channel.slice('session_'.length);
      const handlers = this.subs.get(sessionId);
      if (!handlers || handlers.size === 0) return;
      let payload: { event_index: number };
      try {
        payload = JSON.parse(msg.payload ?? '{}');
      } catch {
        return;
      }
      const event = await this.opts.events.fetchByIndex(sessionId, payload.event_index);
      if (!event) return;
      for (const h of handlers) h(event);
    });
  }

  async start(): Promise<void> {
    if (this.connected) return;
    await this.listener.connect();
    this.connected = true;
  }

  async publish(event: AgentBusPublishInput): Promise<SessionEventRecord> {
    const record = await this.opts.events.append(event);
    if (!this.connected) await this.start();
    await this.listener.query(`SELECT pg_notify($1, $2)`, [
      `session_${record.sessionId}`,
      JSON.stringify({ event_index: record.eventIndex }),
    ]);
    return record;
  }

  async subscribe(sessionId: string, handler: (e: SessionEventRecord) => void): Promise<Unsubscribe> {
    if (!this.connected) await this.start();
    if (!this.subs.has(sessionId)) {
      this.subs.set(sessionId, new Set());
      await this.listener.query(`LISTEN "session_${sessionId}"`);
    }
    for (const r of await this.opts.events.list(sessionId)) handler(r);
    this.subs.get(sessionId)!.add(handler);
    return async () => {
      const set = this.subs.get(sessionId);
      set?.delete(handler);
      if (set && set.size === 0) {
        this.subs.delete(sessionId);
        await this.listener.query(`UNLISTEN "session_${sessionId}"`);
      }
    };
  }

  async *replay(sessionId: string, fromIndex = 0): AsyncIterable<SessionEventRecord> {
    for (const r of await this.opts.events.list(sessionId, fromIndex)) yield r;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.listener.end();
    this.connected = false;
  }
}
