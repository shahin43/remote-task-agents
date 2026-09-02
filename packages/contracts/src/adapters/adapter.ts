import type { Gateway, SessionGateway } from '../gateway/gateway.js';

export interface ChannelAdapter {
  readonly id: string;
  readonly kind: string;
  start(gateway: Gateway | SessionGateway): Promise<void>;
  stop(): Promise<void>;
}
