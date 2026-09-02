import crypto from 'node:crypto';
import type {
  BoardTask,
  TaskAssignment,
  TaskEvent,
  TaskEventKind,
  User,
  Agent,
} from '@remote-sandbox-agents/contracts';
import type {
  BoardStore,
  CreateTaskInput,
  AssignTaskInput,
  UpdateStatusInput,
  CommentInput,
  ListTasksFilter,
} from '../board-store.js';

/** In-memory BoardStore for unit tests. Mirrors PgBoardStore semantics. */
export class InMemoryBoardStore implements BoardStore {
  private readonly tasks = new Map<string, BoardTask>();
  private readonly assignments: TaskAssignment[] = [];
  private readonly events: TaskEvent[] = [];
  private readonly users = new Map<string, User>();
  private readonly agents = new Map<string, Agent>();

  constructor(private readonly generateId: () => string = () => crypto.randomUUID()) {}

  private now(): string {
    return new Date().toISOString();
  }

  private require(taskId: string): BoardTask {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`board task not found: ${taskId}`);
    return t;
  }

  private appendEvent(taskId: string, kind: TaskEventKind, actor: string, payload: Record<string, unknown>): TaskEvent {
    const event: TaskEvent = { id: this.generateId(), taskId, kind, actor, payload, createdAt: this.now() };
    this.events.push(event);
    return event;
  }

  async createTask(input: CreateTaskInput): Promise<BoardTask> {
    const now = this.now();
    const task: BoardTask = {
      id: input.id ?? this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      title: input.title,
      body: input.body ?? '',
      status: input.status ?? 'backlog',
      priority: input.priority ?? 'medium',
      assigneeKind: null,
      assigneeId: null,
      createdBy: input.createdBy,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.appendEvent(task.id, 'created', input.createdBy, { title: task.title, status: task.status });
    return task;
  }

  async getTask(id: string): Promise<BoardTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async listTasks(filter?: ListTasksFilter): Promise<BoardTask[]> {
    return Array.from(this.tasks.values())
      .filter((t) => (filter?.projectId ? t.projectId === filter.projectId : true))
      .filter((t) => (filter?.status ? t.status === filter.status : true))
      .filter((t) => (filter?.assigneeId ? t.assigneeId === filter.assigneeId : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async assignTask(input: AssignTaskInput): Promise<BoardTask> {
    const task = this.require(input.taskId);
    const prior = this.assignments.find((a) => a.taskId === input.taskId && a.unassignedAt === null);
    const now = this.now();
    if (prior) prior.unassignedAt = now;
    this.assignments.push({
      id: this.generateId(),
      taskId: input.taskId,
      assigneeKind: input.assigneeKind,
      assigneeId: input.assigneeId,
      assignedBy: input.assignedBy,
      assignedAt: now,
      unassignedAt: null,
    });
    const updated: BoardTask = { ...task, assigneeKind: input.assigneeKind, assigneeId: input.assigneeId, updatedAt: now };
    this.tasks.set(task.id, updated);
    this.appendEvent(
      task.id,
      prior ? 'reassigned' : 'assigned',
      input.assignedBy,
      {
        from: prior ? { kind: prior.assigneeKind, id: prior.assigneeId } : null,
        to: { kind: input.assigneeKind, id: input.assigneeId },
      },
    );
    return updated;
  }

  async unassignTask(input: { taskId: string; by: string }): Promise<BoardTask> {
    const task = this.require(input.taskId);
    const prior = this.assignments.find((a) => a.taskId === input.taskId && a.unassignedAt === null);
    const now = this.now();
    if (prior) prior.unassignedAt = now;
    const updated: BoardTask = { ...task, assigneeKind: null, assigneeId: null, updatedAt: now };
    this.tasks.set(task.id, updated);
    this.appendEvent(task.id, 'unassigned', input.by, {
      from: prior ? { kind: prior.assigneeKind, id: prior.assigneeId } : null,
    });
    return updated;
  }

  async updateStatus(input: UpdateStatusInput): Promise<BoardTask> {
    const task = this.require(input.taskId);
    const from = task.status;
    const updated: BoardTask = { ...task, status: input.status, updatedAt: this.now() };
    this.tasks.set(task.id, updated);
    this.appendEvent(task.id, 'status_changed', input.by, { from, to: input.status });
    return updated;
  }

  async mergeTaskMetadata(input: { taskId: string; patch: Record<string, unknown> }): Promise<BoardTask> {
    const task = this.require(input.taskId);
    const updated: BoardTask = {
      ...task,
      metadata: { ...task.metadata, ...input.patch },
      updatedAt: this.now(),
    };
    this.tasks.set(task.id, updated);
    return updated;
  }

  async comment(input: CommentInput): Promise<TaskEvent> {
    this.require(input.taskId);
    return this.appendEvent(input.taskId, 'commented', input.by, { text: input.text });
  }

  async assignmentHistory(taskId: string): Promise<TaskAssignment[]> {
    return this.assignments
      .filter((a) => a.taskId === taskId)
      .map((a) => ({ ...a }))
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
  }

  async currentAssignment(taskId: string): Promise<TaskAssignment | null> {
    const open = this.assignments.find((a) => a.taskId === taskId && a.unassignedAt === null);
    return open ? { ...open } : null;
  }

  async taskEvents(taskId: string): Promise<TaskEvent[]> {
    return this.events
      .filter((e) => e.taskId === taskId)
      .map((e) => ({ ...e }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async upsertUser(user: User): Promise<User> {
    this.users.set(user.id, { ...user });
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async listUsers(projectId: string): Promise<User[]> {
    return Array.from(this.users.values()).filter((u) => u.projectId === projectId);
  }

  async upsertAgent(agent: Agent): Promise<Agent> {
    this.agents.set(agent.id, { ...agent });
    return agent;
  }

  async getAgent(id: string): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async listAgents(projectId: string): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter((a) => a.projectId === projectId);
  }

  async deleteAgent(id: string): Promise<boolean> {
    return this.agents.delete(id);
  }
}
