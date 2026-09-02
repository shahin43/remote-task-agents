import type { BoardTask } from '@remote-sandbox-agents/contracts';
import type { BoardStore } from '@remote-sandbox-agents/persistence';
import type { AssigneeTarget } from '@remote-sandbox-agents/orchestrator';
import { AgentConfigLoader } from '@remote-sandbox-agents/orchestrator';

export interface ResolveTargetDeps {
  board: Pick<BoardStore, 'getAgent'>;
  configLoader: AgentConfigLoader;
}

/**
 * Map a board task's agent assignee → routing target via `agents.profile_id`.
 * Loads the profile to distinguish worker vs orchestrator actors.
 */
export function makeResolveTarget(deps: ResolveTargetDeps): (task: BoardTask) => AssigneeTarget {
  return (task: BoardTask): AssigneeTarget => {
    if (!task.assigneeId) return { kind: 'human' };
    // Synchronous fallback when agent row is missing (tests / hand-seeded ids).
    return { kind: 'worker', agentSpecId: task.assigneeId };
  };
}

/** Async resolver that looks up `agents.profile_id` and the profile's `actor`. */
export function makeResolveTargetAsync(deps: ResolveTargetDeps): (task: BoardTask) => Promise<AssigneeTarget> {
  return async (task: BoardTask): Promise<AssigneeTarget> => {
    if (!task.assigneeId) return { kind: 'human' };
    const agent = await deps.board.getAgent(task.assigneeId);
    const profileId = agent?.profileId ?? task.assigneeId;
    try {
      const cfg = await deps.configLoader.resolve(profileId);
      if (cfg.profile.actor === 'orchestrator') {
        return { kind: 'orchestrator', agentSpecId: profileId };
      }
      return { kind: 'worker', agentSpecId: profileId };
    } catch {
      return { kind: 'worker', agentSpecId: profileId };
    }
  };
}
