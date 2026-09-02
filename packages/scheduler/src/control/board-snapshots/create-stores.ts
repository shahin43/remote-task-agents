import { LocalSnapshotStore, type SnapshotStore } from '@remote-sandbox-agents/sandbox';
import { createSnapshotStoreRouter, type SnapshotStoreRouter } from './store-router.js';

export interface SnapshotStoreEnv {
  REMOTE_AGENT_SNAPSHOT_STORE?: string;
}

export function snapshotStoreKind(env: SnapshotStoreEnv = process.env): 'local' {
  const raw = (env.REMOTE_AGENT_SNAPSHOT_STORE ?? 'local').trim().toLowerCase();
  if (raw && raw !== 'local') {
    throw new Error('REMOTE_AGENT_SNAPSHOT_STORE must be local in this service');
  }
  return 'local';
}

export function createBoardSnapshotStores(opts: {
  snapshotRoot: string;
  env?: SnapshotStoreEnv;
}): { router: SnapshotStoreRouter; persistStore: SnapshotStore; local: LocalSnapshotStore } {
  snapshotStoreKind(opts.env ?? process.env);
  const local = new LocalSnapshotStore({ root: opts.snapshotRoot });
  const router = createSnapshotStoreRouter({
    local,
    persist: 'local',
    snapshotRoot: opts.snapshotRoot,
  });
  return { router, persistStore: router.persistStore, local };
}
