import { getAuth } from "../auth/session";
import type {
  Principal,
  ProjectRepoCatalogEntry,
  SessionDetail,
  SessionSummary,
  Task,
  TaskProgress,
  TaskStatus,
  AgentProfile,
  AgentProfileTemplate,
  TaskRuns,
  TaskUsage,
  TaskArtifactsView,
  SessionSnapshots,
  SnapshotFiles,
} from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const auth = getAuth();
  const headers: Record<string, string> = {
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (auth.token) headers["authorization"] = `Bearer ${auth.token}`;
  if (auth.actor) headers["x-remote-agent-actor"] = auth.actor;
  if (options?.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? body.error ?? "Request failed.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export const api = {
  health: () => request<{ ok: boolean; controlAuthRequired: boolean; checks?: { database: string } }>("/api/health"),

  tasks: () => request<Task[]>("/api/tasks"),
  task: (taskId: string) => request<Task>(`/api/tasks/${taskId}`),
  taskProgress: (taskId: string) =>
    request<TaskProgress>(`/api/tasks/${taskId}/progress`),

  taskRuns: (taskId: string) => request<TaskRuns>(`/api/tasks/${taskId}/runs`),
  taskUsage: (taskId: string) => request<TaskUsage>(`/api/tasks/${taskId}/usage`),
  taskArtifacts: (taskId: string) =>
    request<TaskArtifactsView>(`/api/tasks/${taskId}/artifacts`),

  sessionSnapshots: (sessionId: string) =>
    request<SessionSnapshots>(`/api/sessions/${sessionId}/snapshots`),

  snapshotFiles: (encodedRef: string) =>
    request<SnapshotFiles>(`/api/snapshots/${encodeURIComponent(encodedRef)}/files`),

  snapshotFile: async (encodedRef: string, filePath: string): Promise<string> => {
    const file = await api.snapshotFileBytes(encodedRef, filePath);
    return file.blob.text();
  },

  snapshotFileBytes: async (
    encodedRef: string,
    filePath: string,
    download = false,
  ): Promise<{ blob: Blob; contentType: string; filename: string }> => {
    const auth = getAuth();
    const headers: Record<string, string> = {};
    if (auth.token) headers["authorization"] = `Bearer ${auth.token}`;
    const qs = new URLSearchParams({ path: filePath });
    if (download) qs.set("download", "1");
    const response = await fetch(
      `/api/snapshots/${encodeURIComponent(encodedRef)}/file?${qs.toString()}`,
      { headers },
    );
    if (!response.ok) throw new Error("Failed to load snapshot file.");
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? filePath.split("/").pop() ?? "download";
    return { blob: await response.blob(), contentType, filename };
  },

  snapshotArtifactsZip: async (encodedRef: string): Promise<{ blob: Blob; filename: string }> => {
    const auth = getAuth();
    const headers: Record<string, string> = {};
    if (auth.token) headers["authorization"] = `Bearer ${auth.token}`;
    const response = await fetch(
      `/api/snapshots/${encodeURIComponent(encodedRef)}/artifacts.zip`,
      { headers },
    );
    if (!response.ok) throw new Error("Failed to download artifacts.");
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    return {
      blob: await response.blob(),
      filename: match?.[1] ?? "artifacts.zip",
    };
  },

  snapshotWorkspaceTar: async (encodedRef: string): Promise<{ blob: Blob; filename: string }> => {
    const auth = getAuth();
    const headers: Record<string, string> = {};
    if (auth.token) headers["authorization"] = `Bearer ${auth.token}`;
    const response = await fetch(
      `/api/snapshots/${encodeURIComponent(encodedRef)}/workspace.tar`,
      { headers },
    );
    if (!response.ok) throw new Error("Failed to download workspace.");
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    return {
      blob: await response.blob(),
      filename: match?.[1] ?? "workspace.tar",
    };
  },

  createTask: (body: {
    title: string;
    description: string;
    sessionName: string;
    priority?: string;
    assigneeId: string | null;
    repos?: string[];
    primaryRepo?: string | null;
  }) => request<Task>("/api/tasks", json("POST", body)),

  projectRepos: () => request<ProjectRepoCatalogEntry[]>("/api/projects/repos"),

  updateTask: (taskId: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${taskId}`, json("PATCH", body)),

  setStatus: (taskId: string, status: TaskStatus) =>
    request<Task>(`/api/tasks/${taskId}`, json("PATCH", { status })),

  setAssignee: (taskId: string, assigneeId: string | null) =>
    request<Task>(`/api/tasks/${taskId}`, json("PATCH", { assigneeId })),

  addComment: (taskId: string, bodyMarkdown: string) =>
    request<Task>(`/api/tasks/${taskId}/comments`, json("POST", { bodyMarkdown })),

  followUp: (taskId: string, body: { bodyMarkdown: string; resumeWorkspace?: boolean }) =>
    request<Task>(`/api/tasks/${taskId}/follow-up`, json("POST", body)),

  approveMrRequest: (taskId: string, body?: { draft?: boolean; targetBranch?: string }) =>
    request<Task>(`/api/tasks/${taskId}/mr-request/approve`, json("POST", body ?? {})),

  rejectMrRequest: (taskId: string, body?: { reason?: string }) =>
    request<Task>(`/api/tasks/${taskId}/mr-request/reject`, json("POST", body ?? {})),

  assignees: () => request<Principal[]>("/api/assignees"),
  agents: () => request<Principal[]>("/api/agents"),
  agentProfiles: () => request<AgentProfileTemplate[]>("/api/agent-profiles"),
  createAgent: (body: { id?: string; displayName: string; profileId: string }) =>
    request<Principal>("/api/agents", json("POST", body)),
  updateAgent: (agentId: string, body: { displayName?: string; profileId?: string }) =>
    request<Principal>(`/api/agents/${agentId}`, json("PATCH", body)),
  deleteAgent: (agentId: string) =>
    request<void>(`/api/agents/${agentId}`, { method: "DELETE" }),
  agentProfile: (agentId: string) => request<AgentProfile>(`/api/agents/${agentId}`),
  users: () => request<Principal[]>("/api/users"),

  sessions: () => request<SessionSummary[]>("/api/sessions"),
  session: (sessionId: string) =>
    request<SessionDetail>(`/api/sessions/${sessionId}`),

  /**
   * Live-events stream seam. SSE is the Phase 2 upgrade; for v1 the UI polls
   * with TanStack Query and this stays unused. Kept so wiring SSE later is a
   * one-line swap (server already runs on PostgresAgentBus NOTIFY).
   */
  taskChanges: (): EventSource | null => {
    try {
      return new EventSource("/api/events/tasks");
    } catch {
      return null;
    }
  },
};
