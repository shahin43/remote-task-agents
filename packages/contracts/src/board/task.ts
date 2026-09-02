/**
 * Canonical Kanban board domain (system of record for agent work).
 * Every board record carries tenant + project ids: tenancy is modeled from day
 * one and enforced single-tenant for now (auth/isolation deferred to Phase 4).
 */

export type AssigneeKind = 'agent' | 'user';

/** Board-owned status lifecycle (fixed enum v1; per-project config is deferred). */
export type TaskStatus = 'backlog' | 'triaging' | 'working' | 'review' | 'done' | 'failed';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Append-only audit entry kinds for a task. */
export type TaskEventKind =
  | 'created'
  | 'assigned'
  | 'reassigned'
  | 'unassigned'
  | 'status_changed'
  | 'commented';

export interface BoardTask {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  body: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Null when unassigned (sitting in the project backlog). */
  assigneeKind: AssigneeKind | null;
  assigneeId: string | null;
  createdBy: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** One row per assignment; the open row (unassignedAt = null) is the current one. */
export interface TaskAssignment {
  id: string;
  taskId: string;
  assigneeKind: AssigneeKind;
  assigneeId: string;
  assignedBy: string;
  assignedAt: string;
  unassignedAt: string | null;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  kind: TaskEventKind;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
