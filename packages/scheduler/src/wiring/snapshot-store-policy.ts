export type SnapshotStoreKind = 'local';
export type SnapshotDeployment = 'local' | 'production';

export interface SnapshotStorePolicyInput {
  store: SnapshotStoreKind;
  deployment?: string;
  runtime?: string;
}

export function snapshotDeployment(raw: string | undefined): SnapshotDeployment {
  return raw?.trim().toLowerCase() === 'production' ? 'production' : 'local';
}

/** This repo ships a local-disk snapshot store only. */
export function assertSnapshotStorePolicy(input: SnapshotStorePolicyInput): void {
  if (input.store !== 'local') {
    throw new Error('REMOTE_AGENT_SNAPSHOT_STORE must be local in this service');
  }
}
