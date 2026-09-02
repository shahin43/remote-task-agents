import type { SnapshotRef, SnapshotStore } from '@remote-sandbox-agents/sandbox';
import { decodeSnapshotRef } from '@remote-sandbox-agents/sandbox';

export interface SnapshotStoreRouter {
  persistStore: SnapshotStore;
  forRef(ref: SnapshotRef): SnapshotStore;
  decode(encoded: string): SnapshotRef;
}

export function createSnapshotStoreRouter(opts: {
  local: SnapshotStore;
  persist: 'local';
  snapshotRoot: string;
}): SnapshotStoreRouter {
  return {
    persistStore: opts.local,
    forRef() {
      return opts.local;
    },
    decode(encoded) {
      return decodeSnapshotRef(encoded, opts.snapshotRoot);
    },
  };
}
