import crypto from 'node:crypto';
import type {
  BoardTask,
  TaskAssignment,
  TaskEvent,
  TaskStatus,
  TaskPriority,
  AssigneeKind,
  User,
  Agent,
} from '@remote-sandbox-agents/contracts';
import type { PgPool } from './connection.js';

export interface CreateTaskInput {
  /** Optional; the store generates one when omitted. */
  id?: string;
  tenantId: string;
  projectId: string;
  title: string;
  body?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export interface AssignTaskInput {
  taskId: string;
  assigneeKind: AssigneeKind;
  assigneeId: string;
  assignedBy: string;
}

export interface UpdateStatusInput {
  taskId: string;
  status: TaskStatus;
  by: string;
}

export interface CommentInput {
  taskId: string;
  by: string;
  text: string;
}

export interface ListTasksFilter {
  projectId?: string;
  status?: TaskStatus;
  assigneeId?: string;
}

/**
 * Canonical board system of record. All board mutations go through this port so
 * every change produces an auditable `task_event` and assignment lineage is
 * preserved. Multi-table operations (assign/reassign/status) are atomic in the
 * Postgres impl; the in-memory impl is used for unit tests. This is the
 * `BoardStore` port — consumers depend on it, never on a concrete impl.
 */
export interface BoardStore {
  createTask(input: CreateTaskInput): Promise<BoardTask>;
  getTask(id: string): Promise<BoardTask | null>;
  listTasks(filter?: ListTasksFilter): Promise<BoardTask[]>;
  /** Assign/reassign. Closes any open assignment, opens a new one, updates the
   * task assignee, and appends 'assigned' (first) or 'reassigned' (subsequent). */
  assignTask(input: AssignTaskInput): Promise<BoardTask>;
  /** Clear the current assignment (task returns to the backlog queue). */
  unassignTask(input: { taskId: string; by: string }): Promise<BoardTask>;
  updateStatus(input: UpdateStatusInput): Promise<BoardTask>;
  /** Shallow-merge keys into task.metadata (used by repo selection and other channel adapters). */
  mergeTaskMetadata(input: { taskId: string; patch: Record<string, unknown> }): Promise<BoardTask>;
  comment(input: CommentInput): Promise<TaskEvent>;
  assignmentHistory(taskId: string): Promise<TaskAssignment[]>;
  currentAssignment(taskId: string): Promise<TaskAssignment | null>;
  taskEvents(taskId: string): Promise<TaskEvent[]>;

  // Identity (seed + lookup; real auth/invite deferred to Phase 4).
  upsertUser(user: User): Promise<User>;
  getUser(id: string): Promise<User | null>;
  listUsers(projectId: string): Promise<User[]>;
  upsertAgent(agent: Agent): Promise<Agent>;
  getAgent(id: string): Promise<Agent | null>;
  listAgents(projectId: string): Promise<Agent[]>;
  deleteAgent(id: string): Promise<boolean>;
}

// ---- Postgres implementation ----

interface TaskRow {
  [key: string]: unknown;
  id: string; tenant_id: string; project_id: string; title: string; body: string;
  status: string; priority: string; assignee_kind: string | null; assignee_id: string | null;
  created_by: string; metadata: Record<string, unknown>; created_at: unknown; updated_at: unknown;
}
interface AssignmentRow {
  [key: string]: unknown;
  id: string; task_id: string; assignee_kind: string; assignee_id: string;
  assigned_by: string; assigned_at: unknown; unassigned_at: unknown | null;
}
interface EventRow {
  [key: string]: unknown;
  id: string; task_id: string; kind: string; actor: string;
  payload: Record<string, unknown>; created_at: unknown;
}
interface UserRow { [key: string]: unknown; id: string; tenant_id: string; project_id: string; kind: string; display_name: string; external_refs: Record<string, unknown>; }
interface AgentRow { [key: string]: unknown; id: string; tenant_id: string; project_id: string; profile_id: string; display_name: string; }

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

function toTask(r: TaskRow): BoardTask {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, title: r.title, body: r.body,
    status: r.status as TaskStatus, priority: r.priority as TaskPriority,
    assigneeKind: (r.assignee_kind as AssigneeKind | null) ?? null, assigneeId: r.assignee_id ?? null,
    createdBy: r.created_by, metadata: r.metadata ?? {}, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}
function toAssignment(r: AssignmentRow): TaskAssignment {
  return {
    id: r.id, taskId: r.task_id, assigneeKind: r.assignee_kind as AssigneeKind, assigneeId: r.assignee_id,
    assignedBy: r.assigned_by, assignedAt: iso(r.assigned_at), unassignedAt: isoOrNull(r.unassigned_at),
  };
}
function toEvent(r: EventRow): TaskEvent {
  return { id: r.id, taskId: r.task_id, kind: r.kind as TaskEvent['kind'], actor: r.actor, payload: r.payload ?? {}, createdAt: iso(r.created_at) };
}

/** Postgres-backed BoardStore. Multi-table mutations run in one transaction. */
export class PgBoardStore implements BoardStore {
  constructor(private readonly pool: PgPool, private readonly generateId: () => string = () => crypto.randomUUID()) {}

  async createTask(input: CreateTaskInput): Promise<BoardTask> {
    const id = input.id ?? this.generateId();
    return this.pool.withTransaction(async (q) => {
      const { rows } = await q<TaskRow>(
        `INSERT INTO board_tasks(id, tenant_id, project_id, title, body, status, priority, created_by, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, input.tenantId, input.projectId, input.title, input.body ?? '', input.status ?? 'backlog',
         input.priority ?? 'medium', input.createdBy, JSON.stringify(input.metadata ?? {})],
      );
      const task = toTask(rows[0]!);
      await q(
        `INSERT INTO task_events(id, task_id, kind, actor, payload) VALUES ($1,$2,'created',$3,$4)`,
        [this.generateId(), id, input.createdBy, JSON.stringify({ title: task.title, status: task.status })],
      );
      return task;
    });
  }

  async getTask(id: string): Promise<BoardTask | null> {
    const { rows } = await this.pool.query<TaskRow>(`SELECT * FROM board_tasks WHERE id=$1`, [id]);
    return rows[0] ? toTask(rows[0]) : null;
  }

  async listTasks(filter?: ListTasksFilter): Promise<BoardTask[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter?.projectId) { values.push(filter.projectId); clauses.push(`project_id=$${values.length}`); }
    if (filter?.status) { values.push(filter.status); clauses.push(`status=$${values.length}`); }
    if (filter?.assigneeId) { values.push(filter.assigneeId); clauses.push(`assignee_id=$${values.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query<TaskRow>(`SELECT * FROM board_tasks ${where} ORDER BY created_at ASC`, values);
    return rows.map(toTask);
  }

  async assignTask(input: AssignTaskInput): Promise<BoardTask> {
    return this.pool.withTransaction(async (q) => {
      const taskRes = await q<TaskRow>(`SELECT * FROM board_tasks WHERE id=$1 FOR UPDATE`, [input.taskId]);
      if (!taskRes.rows[0]) throw new Error(`board task not found: ${input.taskId}`);
      const prior = (await q<AssignmentRow>(
        `SELECT * FROM task_assignments WHERE task_id=$1 AND unassigned_at IS NULL`, [input.taskId])).rows[0];
      if (prior) await q(`UPDATE task_assignments SET unassigned_at=now() WHERE id=$1`, [prior.id]);
      await q(
        `INSERT INTO task_assignments(id, task_id, assignee_kind, assignee_id, assigned_by) VALUES ($1,$2,$3,$4,$5)`,
        [this.generateId(), input.taskId, input.assigneeKind, input.assigneeId, input.assignedBy],
      );
      const upd = await q<TaskRow>(
        `UPDATE board_tasks SET assignee_kind=$2, assignee_id=$3, updated_at=now() WHERE id=$1 RETURNING *`,
        [input.taskId, input.assigneeKind, input.assigneeId],
      );
      await q(
        `INSERT INTO task_events(id, task_id, kind, actor, payload) VALUES ($1,$2,$3,$4,$5)`,
        [this.generateId(), input.taskId, prior ? 'reassigned' : 'assigned', input.assignedBy,
         JSON.stringify({
           from: prior ? { kind: prior.assignee_kind, id: prior.assignee_id } : null,
           to: { kind: input.assigneeKind, id: input.assigneeId },
         })],
      );
      return toTask(upd.rows[0]!);
    });
  }

  async unassignTask(input: { taskId: string; by: string }): Promise<BoardTask> {
    return this.pool.withTransaction(async (q) => {
      const taskRes = await q<TaskRow>(`SELECT * FROM board_tasks WHERE id=$1 FOR UPDATE`, [input.taskId]);
      if (!taskRes.rows[0]) throw new Error(`board task not found: ${input.taskId}`);
      const prior = (await q<AssignmentRow>(
        `SELECT * FROM task_assignments WHERE task_id=$1 AND unassigned_at IS NULL`, [input.taskId])).rows[0];
      if (prior) await q(`UPDATE task_assignments SET unassigned_at=now() WHERE id=$1`, [prior.id]);
      const upd = await q<TaskRow>(
        `UPDATE board_tasks SET assignee_kind=NULL, assignee_id=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
        [input.taskId],
      );
      await q(
        `INSERT INTO task_events(id, task_id, kind, actor, payload) VALUES ($1,$2,'unassigned',$3,$4)`,
        [this.generateId(), input.taskId, input.by,
         JSON.stringify({ from: prior ? { kind: prior.assignee_kind, id: prior.assignee_id } : null })],
      );
      return toTask(upd.rows[0]!);
    });
  }

  async updateStatus(input: UpdateStatusInput): Promise<BoardTask> {
    return this.pool.withTransaction(async (q) => {
      const taskRes = await q<TaskRow>(`SELECT * FROM board_tasks WHERE id=$1 FOR UPDATE`, [input.taskId]);
      const current = taskRes.rows[0];
      if (!current) throw new Error(`board task not found: ${input.taskId}`);
      const upd = await q<TaskRow>(
        `UPDATE board_tasks SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`, [input.taskId, input.status]);
      await q(
        `INSERT INTO task_events(id, task_id, kind, actor, payload) VALUES ($1,$2,'status_changed',$3,$4)`,
        [this.generateId(), input.taskId, input.by, JSON.stringify({ from: current.status, to: input.status })],
      );
      return toTask(upd.rows[0]!);
    });
  }

  async mergeTaskMetadata(input: { taskId: string; patch: Record<string, unknown> }): Promise<BoardTask> {
    const task = await this.getTask(input.taskId);
    if (!task) throw new Error(`board task not found: ${input.taskId}`);
    const merged = { ...task.metadata, ...input.patch };
    const { rows } = await this.pool.query<TaskRow>(
      `UPDATE board_tasks SET metadata=$2, updated_at=now() WHERE id=$1 RETURNING *`,
      [input.taskId, JSON.stringify(merged)],
    );
    return toTask(rows[0]!);
  }

  async comment(input: CommentInput): Promise<TaskEvent> {
    return this.pool.withTransaction(async (q) => {
      const taskRes = await q<TaskRow>(`SELECT id FROM board_tasks WHERE id=$1`, [input.taskId]);
      if (!taskRes.rows[0]) throw new Error(`board task not found: ${input.taskId}`);
      const { rows } = await q<EventRow>(
        `INSERT INTO task_events(id, task_id, kind, actor, payload) VALUES ($1,$2,'commented',$3,$4) RETURNING *`,
        [this.generateId(), input.taskId, input.by, JSON.stringify({ text: input.text })],
      );
      return toEvent(rows[0]!);
    });
  }

  async assignmentHistory(taskId: string): Promise<TaskAssignment[]> {
    const { rows } = await this.pool.query<AssignmentRow>(
      `SELECT * FROM task_assignments WHERE task_id=$1 ORDER BY assigned_at ASC`, [taskId]);
    return rows.map(toAssignment);
  }

  async currentAssignment(taskId: string): Promise<TaskAssignment | null> {
    const { rows } = await this.pool.query<AssignmentRow>(
      `SELECT * FROM task_assignments WHERE task_id=$1 AND unassigned_at IS NULL`, [taskId]);
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async taskEvents(taskId: string): Promise<TaskEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT * FROM task_events WHERE task_id=$1 ORDER BY created_at ASC, id ASC`, [taskId]);
    return rows.map(toEvent);
  }

  async upsertUser(user: User): Promise<User> {
    await this.pool.query(
      `INSERT INTO users(id, tenant_id, project_id, kind, display_name, external_refs)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id,
         kind=EXCLUDED.kind, display_name=EXCLUDED.display_name, external_refs=EXCLUDED.external_refs`,
      [user.id, user.tenantId, user.projectId, user.kind, user.displayName, JSON.stringify(user.externalRefs)],
    );
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [id]);
    const r = rows[0];
    return r ? { id: r.id, tenantId: r.tenant_id, projectId: r.project_id, kind: r.kind as 'human', displayName: r.display_name, externalRefs: r.external_refs ?? {} } : null;
  }

  async listUsers(projectId: string): Promise<User[]> {
    const { rows } = await this.pool.query<UserRow>(`SELECT * FROM users WHERE project_id=$1 ORDER BY id ASC`, [projectId]);
    return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, projectId: r.project_id, kind: r.kind as 'human', displayName: r.display_name, externalRefs: r.external_refs ?? {} }));
  }

  async upsertAgent(agent: Agent): Promise<Agent> {
    await this.pool.query(
      `INSERT INTO agents(id, tenant_id, project_id, profile_id, display_name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id,
         profile_id=EXCLUDED.profile_id, display_name=EXCLUDED.display_name`,
      [agent.id, agent.tenantId, agent.projectId, agent.profileId, agent.displayName],
    );
    return agent;
  }

  async getAgent(id: string): Promise<Agent | null> {
    const { rows } = await this.pool.query<AgentRow>(`SELECT * FROM agents WHERE id=$1`, [id]);
    const r = rows[0];
    return r ? { id: r.id, tenantId: r.tenant_id, projectId: r.project_id, profileId: r.profile_id, displayName: r.display_name } : null;
  }

  async listAgents(projectId: string): Promise<Agent[]> {
    const { rows } = await this.pool.query<AgentRow>(`SELECT * FROM agents WHERE project_id=$1 ORDER BY id ASC`, [projectId]);
    return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, projectId: r.project_id, profileId: r.profile_id, displayName: r.display_name }));
  }

  async deleteAgent(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM agents WHERE id=$1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}

