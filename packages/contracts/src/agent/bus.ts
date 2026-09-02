import type { SessionEventRecord } from './session.js';

export type AgentBusPublishInput = Omit<SessionEventRecord, 'eventIndex' | 'createdAt'>;
export type Unsubscribe = () => Promise<void>;

export interface AgentBus {
  publish(event: AgentBusPublishInput): Promise<SessionEventRecord>;
  subscribe(sessionId: string, handler: (event: SessionEventRecord) => void): Promise<Unsubscribe>;
  replay(sessionId: string, fromIndex?: number): AsyncIterable<SessionEventRecord>;
}
