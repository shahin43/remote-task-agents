export interface DockerResource {
  containerId: string;
  sessionId?: string;
  runId?: string;
  leaseGeneration?: number;
}

export interface LiveOwnership {
  sessionId: string;
  leaseGeneration: number;
  leaseExpired: boolean;
}

export interface ReconcileResult {
  inspected: string[];
  retained: string[];
  terminated: string[];
  skipped: string[];
}

const claims = new Map<string, Promise<void>>();

/**
 * Terminate only resources whose durable ownership still matches an expired
 * lease generation. Live leases and newer generations are retained.
 */
export async function reconcileDockerResources(opts: {
  resources: DockerResource[];
  ownership: LiveOwnership[];
  terminate: (containerId: string) => Promise<void>;
  claimKey?: string;
}): Promise<ReconcileResult> {
  const bySession = new Map(opts.ownership.map((row) => [row.sessionId, row]));
  const result: ReconcileResult = { inspected: [], retained: [], terminated: [], skipped: [] };

  for (const resource of opts.resources) {
    result.inspected.push(resource.containerId);
    const owner = resource.sessionId ? bySession.get(resource.sessionId) : undefined;
    const generation = resource.leaseGeneration ?? 0;
    const shouldTerminate =
      Boolean(owner) &&
      owner!.leaseExpired &&
      owner!.leaseGeneration === generation;

    if (!shouldTerminate) {
      result.retained.push(resource.containerId);
      continue;
    }

    const key = opts.claimKey ?? resource.containerId;
    let owned = false;
    let work = claims.get(key);
    if (!work) {
      owned = true;
      work = opts.terminate(resource.containerId).finally(() => {
        claims.delete(key);
      });
      claims.set(key, work);
    }
    await work;
    if (owned) result.terminated.push(resource.containerId);
    else result.skipped.push(resource.containerId);
  }
  return result;
}
