import type { SecretRef } from '../worker/envelope.js';

export interface ResolvedSecret {
  id: string;
  value: string;
}

export interface SecretsResolver {
  resolve(refs: SecretRef[]): Promise<ResolvedSecret[]>;
}
