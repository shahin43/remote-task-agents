import type { BoardTask, TaskStatus } from '@remote-sandbox-agents/contracts';
import type { BoardStore } from '@remote-sandbox-agents/persistence';

/** Minimal routing port: the driver only needs "route this task to a session". */
export type TaskRouteFn = (taskId: string) => Promise<{ routed: boolean }>;

export interface BoardChannelDriverOptions {
  /** Source of board tasks. Only `listTasks` is required. */
  board: Pick<BoardStore, 'listTasks'>;
  /** Open/reuse the session for a routable task (e.g. `BoardAssignmentRouter.route`). */
  route: TaskRouteFn;
  /** Restrict polling to a single project. Omit to poll all projects. */
  projectId?: string;
  /**
   * Decide whether a task should be routed this pass. Defaults to: assigned to
   * an agent in `backlog` or `triaging` (not already working/review/done/failed).
   * The router dedups live sessions for `triaging` tasks still in the queue.
   */
  shouldRoute?: (task: BoardTask) => boolean;
}

export interface BoardPollResult {
  /** How many tasks the poll examined. */
  considered: number;
  /** Ids of tasks the router reported as routed. */
  routed: string[];
  /** Ids of routable tasks the router declined (e.g. unassigned/human/dedup). */
  skipped: string[];
}

/** Statuses where the agent run is finished or in-flight — do not open another session. */
const NON_ROUTABLE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'working', 'review', 'done', 'failed',
]);

/**
 * Route agent-assigned tasks that still need an initial worker session.
 * `backlog` + `triaging` only; once a worker claims (`working`) or completes
 * (`review`), the reconciler must stop re-enqueueing (otherwise every poll
 * opens a fresh session after the prior one reaches `succeeded`).
 */
function defaultShouldRoute(task: BoardTask): boolean {
  return task.assigneeKind === 'agent'
    && task.assigneeId != null
    && !NON_ROUTABLE_STATUSES.has(task.status);
}

/**
 * Board channel driver (library-only): polls the board for agent-assigned tasks
 * and hands each to the injected `route` function, which opens/reuses the
 * appropriate session (spec §7). It is the board-specific driver built on the
 * shared `Channel` abstractions; a future `--role control` process can simply
 * loop `pollOnce`. Decoupled from the router (depends only on a `route` port) so
 * it carries no orchestrator dependency.
 */
export class BoardChannelDriver {
  private readonly shouldRoute: (task: BoardTask) => boolean;

  constructor(private readonly opts: BoardChannelDriverOptions) {
    this.shouldRoute = opts.shouldRoute ?? defaultShouldRoute;
  }

  async pollOnce(): Promise<BoardPollResult> {
    const tasks = await this.opts.board.listTasks(
      this.opts.projectId ? { projectId: this.opts.projectId } : undefined,
    );
    const result: BoardPollResult = { considered: tasks.length, routed: [], skipped: [] };
    for (const task of tasks) {
      if (!this.shouldRoute(task)) continue;
      const outcome = await this.opts.route(task.id);
      (outcome.routed ? result.routed : result.skipped).push(task.id);
    }
    return result;
  }
}
