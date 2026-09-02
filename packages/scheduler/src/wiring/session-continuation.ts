import type { AgentBus } from '@remote-sandbox-agents/contracts';
import type { SessionEventsRepo, SessionsRepo } from '@remote-sandbox-agents/persistence';
import type { SnapshotRef } from '@remote-sandbox-agents/sandbox';
import {
  composePriorRunSummary,
  findLatestWorkerEnd,
  snapshotRefFromPayload,
} from './session-attempts.js';

export type ContinuationTrigger = 'board_comment' | 'api' | 'slack_thread';

export interface ContinueSessionInput {
  channelOrigin: string;
  text: string;
  actor: string;
  resumeWorkspace?: boolean;
  trigger: ContinuationTrigger;
}

export interface ContinueSessionResult {
  sessionId: string;
  reopened: boolean;
  appendedEventIndex: number;
  priorSummaryEventIndex?: number;
}

export interface SessionContinuationDeps {
  sessions: SessionsRepo;
  sessionEvents: SessionEventsRepo;
  bus: AgentBus;
}

function isTerminal(status: string): boolean {
  return status === 'closed' || status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function isBusy(status: string): boolean {
  return status === 'running' || status === 'routing';
}

/** Thrown when a follow-up arrives while the session is still in-flight. */
export class SessionBusyError extends Error {
  constructor(
    readonly sessionId: string,
    readonly status: string,
  ) {
    super(`Session ${sessionId} is ${status}; wait for the current run to finish before sending a follow-up.`);
    this.name = 'SessionBusyError';
  }
}

/**
 * Channel-agnostic session continuation. Reopens the (single) session bound to a
 * channel origin, appends the new user input as a `channel.input` event, and
 * optionally carries the prior `lastSnapshotRef` forward as `resumeSnapshotRef`
 * so the worker scheduler can rehydrate the workspace. Board comment, API, and
 * (future) Slack thread reply all call this — only the trigger adapter differs.
 */
export class SessionContinuationService {
  constructor(private readonly deps: SessionContinuationDeps) {}

  async continue(input: ContinueSessionInput): Promise<ContinueSessionResult> {
    const existing = await this.deps.sessions.findByChannelOrigin(input.channelOrigin);
    if (!existing) {
      throw new Error(`no session for channelOrigin: ${input.channelOrigin}`);
    }

    if (isBusy(existing.status)) {
      throw new SessionBusyError(existing.id, existing.status);
    }

    let reopened = false;
    if (isTerminal(existing.status)) {
      await this.deps.sessions.updateStatus(existing.id, 'routing');
      reopened = true;
    }

    const priorAttempt = typeof existing.metadata.attemptNumber === 'number' ? existing.metadata.attemptNumber : 1;
    const patch: Record<string, unknown> = {
      attemptNumber: priorAttempt + (reopened ? 1 : 0),
      resumeSnapshotRef:
        input.resumeWorkspace && existing.metadata.lastSnapshotRef
          ? existing.metadata.lastSnapshotRef
          : null,
    };
    await this.deps.sessions.mergeMetadata(existing.id, patch);

    let priorSummaryEventIndex: number | undefined;
    if (reopened) {
      const history = await this.deps.sessionEvents.list(existing.id);
      const workerEnd = findLatestWorkerEnd(history);
      if (workerEnd) {
        const resumeRef = input.resumeWorkspace
          ? (existing.metadata.lastSnapshotRef as SnapshotRef | undefined)
          : snapshotRefFromPayload(workerEnd.payload);
        const summaryText = composePriorRunSummary({
          priorAttemptNumber: priorAttempt,
          workerEnd,
          resumeWorkspace: Boolean(input.resumeWorkspace),
          snapshotRef: resumeRef ?? null,
        });
        const priorRecord = await this.deps.bus.publish({
          sessionId: existing.id,
          eventType: 'input',
          kind: 'run.summary',
          payload: { text: summaryText, priorAttemptNumber: priorAttempt },
        });
        priorSummaryEventIndex = priorRecord.eventIndex;
      }
    }

    const record = await this.deps.bus.publish({
      sessionId: existing.id,
      eventType: 'input',
      kind: 'channel.input',
      payload: { text: input.text, trigger: input.trigger, actor: input.actor },
    });

    return {
      sessionId: existing.id,
      reopened,
      appendedEventIndex: record.eventIndex,
      priorSummaryEventIndex,
    };
  }
}
