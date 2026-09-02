/**
 * Board principals: humans (`User`) and agent identities (`Agent`). Seeded in
 * single-tenant mode; invite/roles/auth land in Phase 4. Both carry tenant +
 * project ids so the schema never needs a tenancy migration later.
 */

export interface User {
  id: string;
  tenantId: string;
  projectId: string;
  kind: 'human';
  displayName: string;
  /** Provider-native handles (e.g. linear/slack user ids), no credentials. */
  externalRefs: Record<string, unknown>;
}

/** Agent identity bound to a worker/orchestrator profile id. */
export interface Agent {
  id: string;
  tenantId: string;
  projectId: string;
  /** Profile this agent runs as (orchestrator | coding | reviewer | triage | …). */
  profileId: string;
  displayName: string;
}
