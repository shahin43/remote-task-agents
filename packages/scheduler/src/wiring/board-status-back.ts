import type { BoardStore } from '@remote-sandbox-agents/persistence';
import type { TaskEvent, TaskStatus } from '@remote-sandbox-agents/contracts';

export interface WorkerSummaryInput {
  taskId: string;
  status: 'succeeded' | 'failed';
  summary: string;
  /** Principal id recorded on the task events (the worker agent). */
  by: string;
}

export interface WorkerStatusInput {
  taskId: string;
  status: TaskStatus;
  /** Principal id recorded on the task events (the worker agent). */
  by: string;
}

/**
 * Push an in-flight worker status back onto the board (e.g. `working` when a
 * worker claims and starts). Best-effort; callers swallow failures.
 */
export async function postWorkerStatus(store: BoardStore, input: WorkerStatusInput): Promise<TaskEvent | null> {
  const task = await store.getTask(input.taskId);
  if (!task || task.status === input.status) return null;
  await store.updateStatus({ taskId: input.taskId, status: input.status, by: input.by });
  return null;
}

/**
 * Push a finished worker run back onto the board so the task item renders the
 * outcome. Succeeded → `review` (a human/reviewer confirms → done); failed →
 * `failed`. The summary is appended as a comment task_event (the board timeline)
 * and is also what a task-detail view shows. Every write goes through the
 * BoardStore so it stays auditable.
 */
export async function postWorkerSummary(store: BoardStore, input: WorkerSummaryInput): Promise<TaskEvent> {
  await store.updateStatus({
    taskId: input.taskId,
    status: input.status === 'succeeded' ? 'review' : 'failed',
    by: input.by,
  });
  return store.comment({
    taskId: input.taskId,
    by: input.by,
    text: input.summary || (input.status === 'succeeded' ? 'Worker completed the task.' : 'Worker failed.'),
  });
}
