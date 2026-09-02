import type { SessionEventRecord } from '@remote-sandbox-agents/contracts';
import type { SnapshotRef } from '@remote-sandbox-agents/sandbox';
import { encodeSnapshotRef } from '@remote-sandbox-agents/sandbox';

export interface AttemptSnapshotView {
  attemptNumber: number;
  status: string;
  summary: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  snapshotRef: SnapshotRef | null;
  snapshotRefEncoded: string | null;
}

export interface AttemptInputView {
  attemptNumber: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** User messages sent during this attempt (`channel.input`). */
  channelInputs: string[];
  /** Prior-run summary injected at the start of this attempt (`run.summary`). */
  priorSummary: string | null;
  /** Assistant summary produced by this attempt. */
  assistantSummary: string | null;
  error: string | null;
  snapshotRef: SnapshotRef | null;
  snapshotRefEncoded: string | null;
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function textFromPayload(payload: unknown): string | null {
  const record = asRecord(payload);
  const text = record.text;
  return typeof text === 'string' && text.length > 0 ? text : null;
}

function assistantTextFromPayload(payload: unknown): string | null {
  const record = asRecord(payload);
  const content = record.content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((c) => c && typeof c === 'object' && (c as { type?: string }).type === 'text')
    .map((c) => String((c as { text?: string }).text ?? ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : null;
}

export function snapshotRefFromPayload(payload: unknown): SnapshotRef | null {
  const record = asRecord(payload);
  const ref = record.snapshotRef;
  if (!ref || typeof ref !== 'object') return null;
  const typed = ref as { type?: string; id?: string; location?: string };
  if (typeof typed.type !== 'string' || typeof typed.id !== 'string' || typeof typed.location !== 'string') {
    return null;
  }
  return { type: typed.type, id: typed.id, location: typed.location };
}

interface MutableAttempt {
  attemptNumber: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  channelInputs: string[];
  priorSummary: string | null;
  assistantParts: string[];
  error: string | null;
  snapshotRef: SnapshotRef | null;
  snapshotRefEncoded: string | null;
}

function finalizeAttempt(current: MutableAttempt): AttemptInputView {
  return {
    attemptNumber: current.attemptNumber,
    status: current.status,
    startedAt: current.startedAt,
    completedAt: current.completedAt,
    durationMs: current.durationMs,
    channelInputs: current.channelInputs,
    priorSummary: current.priorSummary,
    assistantSummary: current.assistantParts.length > 0 ? current.assistantParts.join('\n\n') : null,
    error: current.error,
    snapshotRef: current.snapshotRef,
    snapshotRefEncoded: current.snapshotRefEncoded,
  };
}

/**
 * Split session events into worker attempts bounded by worker_start / worker_end pairs.
 * Inputs that arrive before the next worker_start (including follow-up messages) attach
 * to the upcoming attempt.
 */
export function buildAttemptViews(events: SessionEventRecord[]): AttemptInputView[] {
  const attempts: AttemptInputView[] = [];
  let preStartInputs: string[] = [];
  let preStartPriorSummary: string | null = null;
  let current: MutableAttempt | null = null;

  const flush = () => {
    if (!current) return;
    attempts.push(finalizeAttempt(current));
    current = null;
  };

  for (const event of events) {
    if (event.eventType === 'turn' && event.kind === 'worker_start') {
      flush();
      const payload = asRecord(event.payload);
      current = {
        attemptNumber: attempts.length + 1,
        status: 'running',
        startedAt: typeof payload.startedAt === 'string' ? payload.startedAt : event.createdAt,
        completedAt: null,
        durationMs: null,
        channelInputs: [...preStartInputs],
        priorSummary: preStartPriorSummary,
        assistantParts: [],
        error: null,
        snapshotRef: null,
        snapshotRefEncoded: null,
      };
      preStartInputs = [];
      preStartPriorSummary = null;
      continue;
    }

    if (event.eventType === 'input' && event.kind === 'channel.input') {
      const text = textFromPayload(event.payload);
      if (!text) continue;
      if (current) current.channelInputs.push(text);
      else preStartInputs.push(text);
      continue;
    }

    if (event.eventType === 'input' && event.kind === 'run.summary') {
      const text = textFromPayload(event.payload);
      if (!text) continue;
      if (current) current.priorSummary = text;
      else preStartPriorSummary = text;
      continue;
    }

    if (!current) continue;

    if (event.eventType === 'turn' && event.kind === 'assistant_message') {
      const text = assistantTextFromPayload(event.payload);
      if (text) current.assistantParts.push(text);
    } else if (event.eventType === 'turn' && event.kind === 'worker_end') {
      const payload = asRecord(event.payload);
      current.status = typeof payload.status === 'string' ? payload.status : 'unknown';
      current.completedAt = event.createdAt;
      current.durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null;
      current.error = typeof payload.error === 'string' ? payload.error : null;
      const ref = snapshotRefFromPayload(event.payload);
      current.snapshotRef = ref;
      current.snapshotRefEncoded = ref ? encodeSnapshotRef(ref) : null;
      if (typeof payload.summary === 'string' && payload.summary && current.assistantParts.length === 0) {
        current.assistantParts.push(payload.summary);
      }
      flush();
    }
  }

  flush();

  if (attempts.length === 0 && (preStartInputs.length > 0 || preStartPriorSummary)) {
    attempts.push({
      attemptNumber: 1,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      durationMs: null,
      channelInputs: preStartInputs,
      priorSummary: preStartPriorSummary,
      assistantSummary: null,
      error: null,
      snapshotRef: null,
      snapshotRefEncoded: null,
    });
  }

  return attempts;
}

/** Snapshot list derived from worker_end events (one entry per completed attempt). */
export function buildSnapshotViews(events: SessionEventRecord[]): AttemptSnapshotView[] {
  return buildAttemptViews(events)
    .filter((a) => a.snapshotRef)
    .map((a) => ({
      attemptNumber: a.attemptNumber,
      status: a.status,
      summary: a.assistantSummary,
      error: a.error,
      durationMs: a.durationMs,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      snapshotRef: a.snapshotRef,
      snapshotRefEncoded: a.snapshotRefEncoded,
    }));
}

/** Find the latest worker_end event in a session's history. */
export function findLatestWorkerEnd(events: SessionEventRecord[]): SessionEventRecord | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.eventType === 'turn' && e.kind === 'worker_end') return e;
  }
  return null;
}

/** Compose the prior-run summary block injected on follow-up. */
export function composePriorRunSummary(opts: {
  priorAttemptNumber: number;
  workerEnd: SessionEventRecord;
  resumeWorkspace: boolean;
  snapshotRef?: SnapshotRef | null;
}): string {
  const payload = asRecord(opts.workerEnd.payload);
  const status = typeof payload.status === 'string' ? payload.status : 'unknown';
  const summary = typeof payload.summary === 'string' ? payload.summary : '';
  const error = typeof payload.error === 'string' ? payload.error : '';
  const lines = [`## Prior run (attempt ${opts.priorAttemptNumber})`];
  lines.push(`Status: ${status}`);
  if (status === 'failed' && error) {
    lines.push(`Error: ${error}`);
  } else if (summary) {
    lines.push(`Summary: ${summary}`);
  }
  if (opts.resumeWorkspace && opts.snapshotRef) {
    lines.push(
      `Workspace restored from checkpoint of attempt ${opts.priorAttemptNumber} (snapshot ${opts.snapshotRef.id}).`,
    );
  }
  return lines.join('\n');
}
