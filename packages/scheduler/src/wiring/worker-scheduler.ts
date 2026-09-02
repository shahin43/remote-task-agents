import { randomUUID } from 'node:crypto';
import type {
  AgentBus, AgentEngine, AgentSpec, AgentTurnResult, SessionRecord, SessionSnapshot, WorkerProfile,
} from '@remote-sandbox-agents/contracts';
import { parseBoardConversationKey } from '@remote-sandbox-agents/contracts';
import type { AgentRunsRepo, SessionsRepo } from '@remote-sandbox-agents/persistence';
import type { SessionWorkspace } from '@remote-sandbox-agents/orchestrator';
import { WorkspaceManager } from '@remote-sandbox-agents/orchestrator';
import type { SandboxManager, Manifest, ProviderOptions, SnapshotRef, SandboxEventSink, SandboxEventPayload, SandboxSession } from '@remote-sandbox-agents/sandbox';
import { SANDBOX_PHASE_TO_ATTEMPT_STATE } from '@remote-sandbox-agents/sandbox';
import { pinnedSkillsFromMetadata } from './resolved-skills.js';
import { piRunnerTemplate } from './agent-runtime-template.js';
import {
  readArtifactsMaxEntries,
  resolveArtifacts,
  type ArtifactDrop,
  type CapturedArtifact,
} from './artifacts.js';

export interface WorkerSchedulerOptions {
  sessions: SessionsRepo;
  /**
   * Per-attempt operational ledger (one row per worker attempt). Inserted at
   * runSession entry, patched on sandbox.created, finalized on worker_end.
   * Optional so legacy callers/tests that don't care about the ledger keep
   * compiling; the live API always provides one.
   */
  agentRuns?: AgentRunsRepo;
  bus: AgentBus;
  workspaceManager: WorkspaceManager;
  /**
   * Build the worker AgentSpec. The optional `sandboxSession` is supplied only on
   * the sandbox path so a pi worker spec can bind its tools to sandbox
   * capabilities (shell/read/write executed in-sandbox). Non-sandbox callers omit it.
   */
  resolveSpec: (session: SessionRecord, sessionRoot?: string, sandboxSession?: SandboxSession) => Promise<AgentSpec>;
  /**
   * Resolve the engine for a spec. The optional second arg is the live sandbox
   * session: the docker runtime needs it so the Pi runner executes inside the container.
   */
  resolveEngine: (spec: AgentSpec, sandboxSession?: SandboxSession) => AgentEngine;
  /** Sandbox compute plane (optional). When all four are present, sandbox-* runtimes use them. */
  sandboxManager?: SandboxManager;
  resolveProfile?: (session: SessionRecord) => Promise<WorkerProfile>;
  resolveProviderOptionsFor?: (
    profile: WorkerProfile,
    ctx?: { session: SessionRecord; runId?: string; workerId?: string; leaseGeneration?: number },
  ) => ProviderOptions;
  buildManifestFor?: (session: SessionRecord, runId: string) => Promise<Manifest> | Manifest;
  /**
   * Claim-lease duration. Must exceed the worst-case turn timeout so a live,
   * slow worker is never swept as crashed. Default 45 minutes.
   */
  leaseMs?: number;
  /** Worker-service instance id stamped onto the claim lease. */
  workerId?: string;
  /**
   * Optional start hook, invoked after `worker_start` is published.
   * Used to push in-progress status back to an external surface (e.g. the board).
   * Failures are swallowed so they never fail an otherwise-running worker.
   */
  onWorkerStart?: (session: SessionRecord) => Promise<void> | void;
  /**
   * Optional completion hook, invoked after `worker_end` + parent notification.
   * Used to push status/summary back to an external surface (e.g. the board).
   * Failures are swallowed so they never fail an otherwise-complete run.
   */
  onWorkerComplete?: (
    session: SessionRecord,
    result: {
      status: 'succeeded' | 'failed';
      summary?: string;
      error?: string;
      /**
       * Opt-in handoff intent emitted by the worker (raw JSON written to
       * `.agent/handoff.json` via the `handoff` Pi tool). Parsed +
       * validated downstream by the board status-back applier.
       */
      handoff?: unknown;
      mrRequest?: unknown;
      artifacts?: CapturedArtifact[];
      artifactDrops?: ArtifactDrop[];
      snapshotRef?: SnapshotRef | null;
      agentRunId?: string;
    },
  ) => Promise<void> | void;
  /**
   * Optional checkpoint hydrate. Invoked right after the sandbox is created and
   * before the engine turn, only when the session carries `metadata.resumeSnapshotRef`.
   */
  hydrateWorkspace?: (
    session: SessionRecord,
    sandboxSession: SandboxSession,
    snapshotRef: SnapshotRef,
  ) => Promise<void>;
}

const DEFAULT_LEASE_MS = 45 * 60_000;
/** Fallback when the spec carries no turnTimeoutMs policy. */
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60_000;

export interface WorkerRunResult {
  sessionId: string;
  status: 'succeeded' | 'failed';
  summary?: string;
  error?: string;
  durationMs: number;
}

export class WorkerScheduler {
  constructor(private readonly opts: WorkerSchedulerOptions) {}

  async claimAndRun(): Promise<WorkerRunResult | null> {
    // Atomic claim: routing -> running with a lease, safe under concurrent
    // claimers. A session whose lease expires while still running is presumed
    // crashed and is failed by reapExpiredLeases().
    const leaseMs = this.opts.leaseMs ?? DEFAULT_LEASE_MS;
    const next = await this.opts.sessions.claimNextRouting(
      'worker',
      new Date(Date.now() + leaseMs).toISOString(),
      this.opts.workerId ? { workerId: this.opts.workerId } : undefined,
    );
    if (!next) return null;

    return this.runSession(next);
  }

  /**
   * Fail worker sessions whose claim lease expired while still `running` —
   * the claiming process crashed mid-run (or wildly exceeded its lease).
   * Publishes worker_end + child_session_completed so the parent orchestrator
   * can decide whether to re-dispatch.
   */
  async reapExpiredLeases(): Promise<number> {
    const expired = await this.opts.sessions.listExpiredRunning('worker', new Date().toISOString());
    for (const session of expired) {
      const error = 'Worker lease expired: the claiming process crashed or exceeded its lease.';
      await this.opts.sessions.updateStatus(session.id, 'failed');
      await this.opts.bus.publish({
        sessionId: session.id,
        eventType: 'turn',
        kind: 'worker_end',
        payload: { status: 'failed', summary: error, durationMs: 0, error },
      });
      if (session.parentSessionId) {
        await this.opts.bus.publish({
          sessionId: session.parentSessionId,
          eventType: 'input',
          kind: 'child_session_completed',
          payload: {
            childId: session.id,
            status: 'failed',
            summary: error,
            agentSpecId: session.agentSpecId,
            toolsUsed: [],
            turnsUsed: 0,
            error,
          },
        });
      }
      if (this.opts.onWorkerComplete) {
        try {
          await this.opts.onWorkerComplete(session, { status: 'failed', summary: error, error });
        } catch {
          /* never fail lease sweep on a status-back error */
        }
      }
    }
    return expired.length;
  }

  async runSession(session: SessionRecord): Promise<WorkerRunResult> {
    const startedAt = Date.now();

    // Claim: set status to running (no-op for sessions already claimed
    // atomically via claimAndRun; kept for direct runSession callers).
    await this.opts.sessions.updateStatus(session.id, 'running');

    // Publish turn_start event
    await this.opts.bus.publish({
      sessionId: session.id,
      eventType: 'turn',
      kind: 'worker_start',
      payload: { startedAt: new Date(startedAt).toISOString(), agentSpecId: session.agentSpecId },
    });

    // Per-attempt operational row. attemptNumber is the session's monotonic
    // counter (bumped by SessionContinuationService on follow-up); first run
    // defaults to 1. taskId is recovered from the board-flavoured
    // channelOrigin so cross-task SQL ("all runs for this task") needs no
    // metadata lookup. agentRuns is optional so legacy/non-board callers and
    // tests can skip the ledger entirely.
    const attemptNumber = readAttemptNumber(session.metadata);
    const taskId = session.channelOrigin
      ? parseBoardConversationKey(session.channelOrigin)?.taskId ?? null
      : null;
    const runId = randomUUID();
    if (this.opts.agentRuns) {
      await this.opts.agentRuns
        .start({
          id: runId,
          sessionId: session.id,
          taskId,
          attemptNumber,
          agentSpecId: session.agentSpecId,
        })
        .catch(() => {
          /* ledger failures must never abort a worker; observability is best-effort */
        });
    }

    if (this.opts.onWorkerStart) {
      try {
        await this.opts.onWorkerStart(session);
      } catch {
        /* never fail a running worker on a status-back error */
      }
    }

    let workspace: SessionWorkspace | null = null;
    let status: 'succeeded' | 'failed' = 'succeeded';
    let summary: string | undefined;
    let error: string | undefined;
    let workerResult: AgentTurnResult | undefined;
    let snapshotRef: SnapshotRef | undefined;
    let resolvedArtifacts: CapturedArtifact[] | undefined;
    let artifactDrops: ArtifactDrop[] | undefined;

    try {
      const profile = this.opts.resolveProfile ? await this.opts.resolveProfile(session) : undefined;
      const useSandbox = Boolean(
        profile && profile.runtime.startsWith('sandbox-') &&
        this.opts.sandboxManager && this.opts.resolveProviderOptionsFor && this.opts.buildManifestFor,
      );

      if (useSandbox) {
        const sandboxRun = await this.runInSandbox(session, profile!, runId);
        workerResult = sandboxRun.workerResult;
        status = sandboxRun.status;
        summary = sandboxRun.summary;
        error = sandboxRun.error;
        snapshotRef = sandboxRun.snapshotRef;
        resolvedArtifacts = sandboxRun.artifacts;
        artifactDrops = sandboxRun.artifactDrops;
      } else {
        // ---- legacy WorkspaceManager path (unchanged) ----
        const spec = await this.opts.resolveSpec(session);
        const engine = this.opts.resolveEngine(spec);

        // Prepare workspace
        workspace = await this.opts.workspaceManager.create(session.id);

        // Inject context from session metadata
        const meta = session.metadata as Record<string, unknown>;
        await this.opts.workspaceManager.injectSessionContext(workspace, {
          goal: (meta.goal as string) ?? 'No goal specified',
          ticket: meta.ticket as { key: string; title: string; description?: string; url?: string } | undefined,
          repo: meta.repo as { provider: string; projectId: string; baseBranch: string; targetPaths: string[] } | undefined,
          orchestratorNotes: (meta.orchestratorNotes as string) ?? undefined,
          parentSessionId: session.parentSessionId ?? 'unknown',
          channelOrigin: session.channelOrigin ?? undefined,
        });

        // Clone repo if path provided in metadata
        const repoLocalPath = meta.repoLocalPath as string | undefined;
        if (repoLocalPath) {
          await this.opts.workspaceManager.cloneRepo(workspace, repoLocalPath);
        }

        // Build session snapshot for the engine
        const history = [];
        for await (const e of this.opts.bus.replay(session.id)) history.push(e);
        const snapshot: SessionSnapshot = { session: { ...session, status: 'running' }, history };

        // Run the engine under the profile's turn timeout
        const result = await this.runEngineTurn(engine, spec, snapshot);
        workerResult = result;

        if (result.finishReason === 'error' || result.finishReason === 'aborted') {
          status = 'failed';
          error = result.errorMessage ?? `Worker turn ${result.finishReason}`;
          summary = `Worker failed: ${error}`;
        } else {
          summary = result.finalMessage ?? 'Worker completed without a message.';
        }

        // Publish tool calls and final message to worker session events
        for (const call of result.toolCalls) {
          await this.opts.bus.publish({
            sessionId: session.id,
            eventType: 'action',
            kind: `tool_call.${call.name}`,
            payload: call,
          });
        }
        if (result.finalMessage) {
          await this.opts.bus.publish({
            sessionId: session.id,
            eventType: 'turn',
            kind: 'worker_result',
            payload: { text: result.finalMessage, usage: result.usage },
          });
        }
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
      summary = `Worker crashed: ${error}`;
    }

    const durationMs = Date.now() - startedAt;

    // Update session status
    await this.opts.sessions.updateStatus(session.id, status);

    // Publish completion event on the worker session
    await this.opts.bus.publish({
      sessionId: session.id,
      eventType: 'turn',
      kind: 'worker_end',
      payload: { status, summary, durationMs, error, snapshotRef },
    });

    if (snapshotRef) {
      // lastSnapshotRef is kept on sessions.metadata as the hot path for the
      // follow-up resume code (SessionContinuationService reads it
      // synchronously to decide whether to hydrate). The same ref is also
      // persisted on agent_runs below, where SQL queries should look.
      await this.opts.sessions.mergeMetadata(session.id, { lastSnapshotRef: snapshotRef }).catch(() => {});
    }

    // Finalize the per-attempt ledger row. Carries the operationally useful
    // bits: terminal status, duration, snapshot ref (as JSONB for queries),
    // summary/error text, finishReason, token usage, tools used.
    if (this.opts.agentRuns) {
      await this.opts.agentRuns
        .finalize({
          id: runId,
          status,
          endedAt: new Date().toISOString(),
          durationMs,
          snapshotRef: snapshotRef as Record<string, unknown> | undefined,
          summary,
          error,
          finishReason: workerResult?.finishReason ?? null,
          tokenUsage: workerResult?.usage as Record<string, unknown> | undefined,
          toolsUsed: [...new Set(workerResult?.toolCalls.map((tc) => tc.name) ?? [])],
          skillsUsed: (() => {
            const pinned = pinnedSkillsFromMetadata(session.metadata as Record<string, unknown>);
            return pinned.length > 0
              ? pinned.map((s) => ({ id: s.id, version: s.version, contentHash: s.contentHash, source: s.source }))
              : null;
          })(),
          artifacts: resolvedArtifacts,
        })
        .catch(() => {
          /* ledger failures must never abort a worker */
        });
    }

    // Notify parent orchestrator session with a structured summary. This is the
    // ONLY view the orchestrator gets of the worker run — rich enough to make a
    // good follow-up decision without replaying the full worker transcript.
    if (session.parentSessionId) {
      await this.opts.bus.publish({
        sessionId: session.parentSessionId,
        eventType: 'input',
        kind: 'child_session_completed',
        payload: {
          childId: session.id,
          status,
          summary,
          durationMs,
          agentSpecId: session.agentSpecId,
          toolsUsed: [...new Set(workerResult?.toolCalls.map((tc) => tc.name) ?? [])],
          turnsUsed: workerResult?.rawMessages?.filter(
            (m) => (m as { role?: string }).role === 'assistant',
          ).length ?? 0,
          tokenUsage: workerResult?.usage,
          snapshotRef,
          error,
        },
      });
    }

    // Completion hook (e.g. board status/summary-back). Best-effort.
    if (this.opts.onWorkerComplete) {
      try {
        await this.opts.onWorkerComplete(session, {
          status,
          summary,
          error,
          handoff: workerResult?.handoff,
          mrRequest: workerResult?.mrRequest,
          artifacts: resolvedArtifacts,
          artifactDrops,
          snapshotRef: snapshotRef ?? null,
          agentRunId: runId,
        });
      } catch {
        /* never fail a completed run on a status-back error */
      }
    }

    // Legacy workspace cleanup (sandbox runtimes snapshot+destroy inside runInSandbox).
    if (workspace) {
      if (status === 'succeeded') {
        await this.opts.workspaceManager.cleanup(workspace).catch(() => {});
      }
      // On failure, retain for inspection
    }

    return { sessionId: session.id, status, summary, error, durationMs };
  }

  /**
   * Run one engine turn under the spec's turnTimeoutMs. On timeout the abort
   * signal fires first (well-behaved engines return an 'aborted' result and
   * clean up); if the engine ignores the signal entirely, a hard rejection
   * 30s later keeps the scheduler loop from hanging forever.
   */
  private async runEngineTurn(
    engine: AgentEngine,
    spec: AgentSpec,
    snapshot: SessionSnapshot,
  ): Promise<AgentTurnResult> {
    const timeoutMs = spec.policies.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    const ctrl = new AbortController();
    let abortTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;
    const hardStop = new Promise<never>((_, reject) => {
      abortTimer = setTimeout(() => {
        ctrl.abort();
        hardTimer = setTimeout(
          () => reject(new Error(`Worker turn ignored abort signal; hard timeout after ${timeoutMs}ms`)),
          30_000,
        );
      }, timeoutMs);
    });
    hardStop.catch(() => {}); // avoid unhandled rejection when the turn wins the race
    try {
      return await Promise.race([
        engine.runTurn({ spec, session: snapshot, bus: this.opts.bus, signal: ctrl.signal }),
        hardStop,
      ]);
    } finally {
      clearTimeout(abortTimer);
      clearTimeout(hardTimer);
    }
  }

  private async runInSandbox(
    session: SessionRecord,
    profile: WorkerProfile,
    agentRunId?: string,
  ): Promise<{
    workerResult?: AgentTurnResult;
    status: 'succeeded' | 'failed';
    summary?: string;
    error?: string;
    snapshotRef?: SnapshotRef;
    artifacts?: CapturedArtifact[];
    artifactDrops?: ArtifactDrop[];
  }> {
    const manager = this.opts.sandboxManager!;
    // The manifest builder names the run; we keep this as the session id for
    // continuity with existing callers (e.g. workspace cache naming).
    const manifestRunId = session.id;
    const manifest = await this.opts.buildManifestFor!(session, manifestRunId);
    const options = this.opts.resolveProviderOptionsFor!(profile, {
      session,
      runId: agentRunId,
      workerId: session.leaseOwner ?? this.opts.workerId,
      leaseGeneration: session.leaseGeneration,
    });

    // Bus-backed sink: persist every sandbox.* lifecycle event to the worker
    // session's event stream (UI/bus-ready) and project the phase onto a
    // human-readable attemptState on the session metadata. This is the only
    // observability the live loop has into the sandbox compute plane.
    //
    // On `created` we also patch the agent_runs ledger row with the sandbox
    // session id, container id and backend so `SELECT ... FROM agent_runs
    // WHERE status NOT IN ('succeeded','failed')` shows the live container
    // without scanning session_events.
    const sink: SandboxEventSink = {
      emit: async (type, payload) => {
        await this.opts.bus.publish({ sessionId: session.id, eventType: 'system', kind: type, payload });
        const sp = payload as SandboxEventPayload | undefined;
        const phase = sp?.phase;
        const attemptState = phase ? SANDBOX_PHASE_TO_ATTEMPT_STATE[phase] : undefined;
        if (attemptState) await this.opts.sessions.mergeMetadata(session.id, { attemptState });
        if (
          phase === 'created' &&
          sp?.sessionId &&
          agentRunId &&
          this.opts.agentRuns
        ) {
          await this.opts.agentRuns
            .markSandboxReady({
              id: agentRunId,
              backend: sp.backend,
              sandboxSessionId: sp.sessionId,
              containerId: sp.container?.id ?? null,
              workspaceLocation: null,
              guestImage: sp.container?.identity ?? null,
            })
            .catch(() => {
              /* ledger best-effort */
            });
        }
      },
    };

    let sandboxSession: Awaited<ReturnType<SandboxManager['create']>> | undefined;
    let snapshotRef: SnapshotRef | undefined;
    try {
      sandboxSession = await manager.create({ manifest, options }, sink);

      // Docker runtime only: `guest engine` refuses to start if AGENT_HOME
      // does not already exist in-container (smoke harness fix #4). The host
      // never has this path; create it inside the container before the engine runs.
      if (sandboxSession.state.type === 'docker') {
        await sandboxSession.exec(['mkdir', '-p', '/workspace/.agent'], { shell: false });
      }

      const resumeRef = (session.metadata as Record<string, unknown>).resumeSnapshotRef as SnapshotRef | null | undefined;
      if (resumeRef && this.opts.hydrateWorkspace) {
        try {
          await this.opts.hydrateWorkspace(session, sandboxSession, resumeRef);
          await sink.emit('sandbox.workspace.hydrated', {
            sessionId: session.id,
            phase: 'materialized',
            backend: sandboxSession.state.type,
            at: new Date().toISOString(),
            detail: { snapshotId: (resumeRef as { id?: string }).id ?? null },
          });
        } catch (err) {
          await sink.emit('sandbox.workspace.hydrate_failed', {
            sessionId: session.id,
            phase: 'error',
            backend: sandboxSession.state.type,
            at: new Date().toISOString(),
            error: { message: err instanceof Error ? err.message : String(err) },
          } satisfies SandboxEventPayload);
        }
        await this.opts.sessions.mergeMetadata(session.id, { resumeSnapshotRef: null }).catch(() => {});
      }

      const spec = await this.opts.resolveSpec(session, sandboxSession.state.workspaceRoot, sandboxSession);
      let result: AgentTurnResult;
      let resolvedArtifacts: CapturedArtifact[] | undefined;
      let artifactDrops: ArtifactDrop[] | undefined;
      if (sandboxSession.runIsolatedAgent) {
        await sandboxSession.runIsolatedAgent();
        const collected = await piRunnerTemplate.collect(sandboxSession);
        const failed = sandboxSession.state.runStatus === 'failed';
        result = {
          toolCalls: collected.events
            .filter((e) => e.type === 'tool_call')
            .map((e) => e.data as AgentTurnResult['toolCalls'][number]),
          finalMessage: collected.summary || undefined,
          finishReason: failed ? 'error' : 'completed',
          errorMessage: failed ? String(sandboxSession.state.runError ?? 'isolated guest run failed') : undefined,
          usage: collected.usage,
          handoff: collected.handoff,
          mrRequest: collected.mrRequest,
          artifacts: collected.artifacts,
        };
      } else {
        const engine = this.opts.resolveEngine(spec, sandboxSession);
        const history = [];
        for await (const e of this.opts.bus.replay(session.id)) history.push(e);
        const snapshot: SessionSnapshot = { session: { ...session, status: 'running' }, history };
        result = await this.runEngineTurn(engine, spec, snapshot);
      }

      // Live Docker uses PiRunnerEngineAdapter (no runIsolatedAgent). Capture
      // after either path so declared/derived deliverables persist on agent_runs.
      const captured = await captureSandboxArtifacts(sandboxSession, result.artifacts);
      resolvedArtifacts = captured.kept;
      artifactDrops = captured.dropped;

      let status: 'succeeded' | 'failed' = 'succeeded';
      let summary: string | undefined;
      let error: string | undefined;
      if (result.finishReason === 'error' || result.finishReason === 'aborted') {
        status = 'failed';
        error = result.errorMessage ?? `Worker turn ${result.finishReason}`;
        summary = `Worker failed: ${error}`;
      } else {
        summary = result.finalMessage ?? 'Worker completed without a message.';
      }
      if (result.finalMessage) {
        await this.opts.bus.publish({ sessionId: session.id, eventType: 'turn', kind: 'worker_result', payload: { text: result.finalMessage, usage: result.usage } });
      }

      // Harness-owned git commit (review B3 / smoke fix #6): the harness — never
      // the harness — commits the working tree before the snapshot, so a coding run
      // produces a deterministic, non-empty git/changes.patch. Only on success,
      // only when the manifest declares a git mount. Backend-agnostic via exec().
      if (status === 'succeeded') {
        const gitMount = gitMountEntry(manifest);
        if (gitMount) {
          await this.harnessCommit(sandboxSession, gitMount.dest, gitMount.workingBranch, session, sink);
        }
      }

      // Snapshot BEFORE destroy (retention artifact for success AND failure).
      // A snapshot failure must be observable (review M8) but must not fail an
      // otherwise-successful run — the diff is best-effort retention.
      snapshotRef = await manager.snapshot(sandboxSession, {}, sink).catch(async (err) => {
        await sink.emit('sandbox.snapshot.failed', {
          sessionId: session.id,
          phase: 'error',
          backend: sandboxSession!.state.type,
          at: new Date().toISOString(),
          error: { message: err instanceof Error ? err.message : String(err) },
        } satisfies SandboxEventPayload);
        return undefined;
      });
      return { workerResult: result, status, summary, error, snapshotRef, artifacts: resolvedArtifacts, artifactDrops };
    } finally {
      if (sandboxSession) await manager.destroy(sandboxSession, sink).catch(() => {});
    }
  }

  /**
   * Stage and commit the working tree inside the sandbox. The commit step
   * tolerates a non-zero exit ("nothing to commit") and reports it as a no-diff
   * rather than a failure. Emits sandbox.harness_commit so the outcome is visible
   * on the session stream.
   */
  private async harnessCommit(
    sandboxSession: SandboxSession,
    gitDest: string,
    workingBranch: string,
    session: SessionRecord,
    sink: SandboxEventSink,
  ): Promise<void> {
    const message = `agent: ${goalSlug(session.metadata)}`;
    // Agent may have checked out a feature branch; fold HEAD into the harness branch
    // so snapshot capture and MR promotion both reference the same tip.
    await sandboxSession.exec(['git', '-C', gitDest, 'branch', '-f', workingBranch, 'HEAD'], { shell: false });
    await sandboxSession.exec(['git', '-C', gitDest, 'checkout', workingBranch], { shell: false });
    await sandboxSession.exec(['git', '-C', gitDest, 'add', '-A'], { shell: false });
    const commit = await sandboxSession.exec(
      [
        'git', '-C', gitDest,
        '-c', 'user.email=agent@remote-sandbox-agents',
        '-c', 'user.name=remote-sandbox-agents',
        'commit', '-m', message, '--no-gpg-sign',
      ],
      { shell: false },
    );
    const committed = commit.exitCode === 0;
    await sink.emit('sandbox.harness_commit', {
      sessionId: session.id,
      backend: sandboxSession.state.type,
      at: new Date().toISOString(),
      detail: { committed, message: committed ? message : 'nothing-to-commit', dest: gitDest },
    });
  }
}

function readAttemptNumber(metadata: Record<string, unknown>): number {
  const raw = metadata?.attemptNumber;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  return 1;
}

/** First git_mount entry in a manifest, if any. */
function gitMountEntry(manifest: Manifest): { dest: string; workingBranch: string } | undefined {
  for (const entry of Object.values(manifest.entries) as Array<{ type?: string; dest?: string; workingBranch?: string }>) {
    if (entry.type === 'git_mount' && typeof entry.dest === 'string' && typeof entry.workingBranch === 'string') {
      return { dest: entry.dest, workingBranch: entry.workingBranch };
    }
  }
  return undefined;
}

/** A short, filesystem/commit-safe slug from the session goal. */
function goalSlug(metadata: Record<string, unknown>): string {
  const goal = typeof metadata.goal === 'string' ? metadata.goal : 'work';
  const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return slug || 'work';
}

async function captureSandboxArtifacts(
  session: SandboxSession,
  declared: unknown,
): Promise<ReturnType<typeof resolveArtifacts>> {
  const sidecar = declared !== undefined
    ? declared
    : (await piRunnerTemplate.collect(session)).artifacts;
  const snapshotPaths = await listSandboxArtifactPaths(session);
  return resolveArtifacts({
    declared: sidecar,
    snapshotPaths,
    maxEntries: readArtifactsMaxEntries(),
  });
}

async function listSandboxArtifactPaths(session: SandboxSession): Promise<string[]> {
  try {
    const result = await session.exec(['sh', '-c', 'find artifacts -type f 2>/dev/null'], { shell: false });
    if (result.exitCode !== 0 || !result.stdout) return [];
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
