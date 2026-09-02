import type { BoardStore } from '@remote-sandbox-agents/persistence';

/**
 * Board agent ids the service seeds for local/alpha. Unique globally; listed
 * even if `project_id` drifted from `REMOTE_AGENT_BOARD_PROJECT_ID`.
 */
export const SHIPPED_BOARD_AGENT_IDS = ['agent-coder', 'agent-reviewer', 'agent-author'] as const;

export interface EnsureBoardPrincipalsOptions {
  board: Pick<BoardStore, 'upsertUser' | 'upsertAgent'>;
  tenantId: string;
  projectId: string;
  /** Worker profile id for the default board agent (env override supported). */
  defaultAgentProfileId?: string;
}

/**
 * Idempotent dev seed for the board UI assignee picker. Each board agent's
 * `profile_id` is what `resolveTarget` maps onto `session.agent_spec_id`,
 * which in turn selects the worker engine and sandbox runtime.
 *
 * The single-tenant dev seed provides the shipped board agents:
 *   - `agent-coder`    → `coder` profile (implementation)
 *   - `agent-reviewer` → `reviewer` profile (code review)
 *   - `agent-author`   → `author` profile (documents)
 *   - `user-dev`       → human operator (closes tasks, breaks ties)
 *
 * The `defaultAgentProfileId` option / env override is preserved for cases
 * where an operator wants the default `agent-coder` row pinned to a custom
 * profile id (e.g. a workspace-local override under `.remote-agent/agents/`).
 */
export async function ensureBoardDevPrincipals(opts: EnsureBoardPrincipalsOptions): Promise<void> {
  if (process.env.REMOTE_AGENT_BOARD_SEED_PRINCIPALS === 'false') return;

  const coderProfileId =
    opts.defaultAgentProfileId ??
    process.env.REMOTE_AGENT_BOARD_DEFAULT_AGENT_PROFILE ??
    'coder';

  await opts.board.upsertUser({
    id: 'user-dev',
    tenantId: opts.tenantId,
    projectId: opts.projectId,
    kind: 'human',
    displayName: 'Dev operator',
    externalRefs: {},
  });

  await opts.board.upsertAgent({
    id: 'agent-coder',
    tenantId: opts.tenantId,
    projectId: opts.projectId,
    profileId: coderProfileId,
    displayName: 'Coder',
  });

  await opts.board.upsertAgent({
    id: 'agent-reviewer',
    tenantId: opts.tenantId,
    projectId: opts.projectId,
    profileId: 'reviewer',
    displayName: 'Reviewer',
  });

  await opts.board.upsertAgent({
    id: 'agent-author',
    tenantId: opts.tenantId,
    projectId: opts.projectId,
    profileId: 'author',
    displayName: 'Author',
  });
}
