import type { GuestImageIdentity } from './guest-image.js';

/**
 * Event sink for sandbox lifecycle + engine events. `emit(type, payload)` is structurally
 * identical to the worker EventSink in @remote-sandbox-agents/contracts, so one object satisfies both
 * at the call site WITHOUT packages/sandbox importing contracts (keeps sandbox standalone).
 *
 * DEC8 (Hermes review Gaps #5/#6): the payload is a rich, typed SandboxEventPayload — container
 * id/image/resources/network + timing + error — so the stream is UI/bus-ready from day one. The
 * emit() SIGNATURE is unchanged; only the payload shape is richer.
 */
export interface SandboxEventSink {
  emit(type: string, payload: unknown): Promise<void>;
}

/** Ordered sandbox lifecycle phases (the `phase` field on every sandbox.* payload). */
export type SandboxPhase =
  | 'creating' | 'created' | 'started'
  | 'materializing' | 'materialized'
  | 'exec_attached'
  | 'snapshotting' | 'snapshotted'
  | 'stopping' | 'stopped' | 'destroyed'
  | 'error';

/** Container metadata stamped by the provider into session state, projected onto events. */
export interface SandboxContainerInfo {
  id: string;
  image?: string;
  /** Image digest (`sha256:…`) from `docker inspect`, when available. */
  digest?: string;
  identity?: GuestImageIdentity;
  labels?: Record<string, string>;
  resources?: { cpus?: string; memoryMb?: number; pids?: number };
  network?: boolean;
}

/** The typed payload carried by every `sandbox.*` event (DEC8). */
export interface SandboxEventPayload {
  sessionId: string;
  phase: SandboxPhase;
  backend: string;
  at: string;
  container?: SandboxContainerInfo;
  durationMs?: number;
  snapshotRef?: { location: string; id?: string };
  detail?: Record<string, unknown>;
  error?: { message: string };
}

/**
 * Projects sandbox phases onto the Hermes review Gap #5 worker-attempt vocabulary. The sandbox
 * unit does NOT own DB run-state/heartbeats/claims (deferred to the live-loop milestone); this map
 * lets the orchestrator translate emitted phases into the typed attempt record with zero redesign.
 * `claimed`/`blocked`/`cancelled`/`reclaimed` are orchestrator-owned and never emitted here.
 */
export const SANDBOX_PHASE_TO_ATTEMPT_STATE: Record<SandboxPhase, string> = {
  creating: 'starting_sandbox',
  created: 'starting_sandbox',
  started: 'starting_sandbox',
  materializing: 'starting_sandbox',
  materialized: 'starting_sandbox',
  exec_attached: 'running_engine',
  snapshotting: 'snapshotting',
  snapshotted: 'snapshotting',
  stopping: 'succeeded',
  stopped: 'succeeded',
  destroyed: 'succeeded',
  error: 'failed',
};

/** A no-op sink (default when the caller does not provide one). */
export class NullSandboxEventSink implements SandboxEventSink {
  async emit(_type: string, _payload: unknown): Promise<void> {
    /* intentionally empty */
  }
}
