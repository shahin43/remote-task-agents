import { useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import type { Task, TaskStatus } from "../api/types";
import { BoardColumn } from "../components/board-column";
import { CreateTaskModal } from "../components/create-task-modal";
import { TaskDrawer } from "../components/task-drawer";
import { STATUS_COLUMNS } from "../lib/status";

export function BoardPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<TaskStatus | null>(null);

  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: api.tasks,
    // Poll so in-progress runs surface their status without a manual refresh.
    refetchInterval: 4000,
  });
  const users = useQuery({ queryKey: ["assignees"], queryFn: api.assignees });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  const createTask = useMutation({
    mutationFn: api.createTask,
    onSuccess: (task) => {
      refresh();
      setCreating(false);
      setSelectedId(task.id);
    },
    onError: (error) => setMessage(error.message),
  });

  const selected = tasks.data?.find((task) => task.id === selectedId) ?? null;

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateTask(selected!.id, body),
    onSuccess: () => {
      refresh();
      if (selected) {
        queryClient.invalidateQueries({ queryKey: ["task-progress", selected.id] });
      }
    },
    onError: (error) => setMessage(error.message),
  });

  const comment = useMutation({
    mutationFn: (body: string) => api.addComment(selected!.id, body),
    onSuccess: refresh,
    onError: (error) => setMessage(error.message),
  });

  const followUp = useMutation({
    mutationFn: (body: { bodyMarkdown: string; resumeWorkspace: boolean }) =>
      api.followUp(selected!.id, body),
    onSuccess: () => {
      refresh();
      if (selected) {
        queryClient.invalidateQueries({ queryKey: ["task-progress", selected.id] });
      }
    },
    onError: (error) => setMessage(error.message),
  });

  const moveTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      api.setStatus(taskId, status),
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previous = queryClient.getQueryData<Task[]>(["tasks"]);
      queryClient.setQueryData<Task[]>(["tasks"], (current) =>
        current?.map((task) => (task.id === taskId ? { ...task, status } : task)),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(["tasks"], context?.previous);
      setMessage(error.message);
    },
    onSettled: refresh,
  });

  function handleDragStart(event: DragEvent<HTMLButtonElement>, task: Task) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    setDraggedTaskId(task.id);
  }

  function handleDragEnd() {
    setDraggedTaskId(null);
    setDropStatus(null);
  }

  function handleDrop(status: TaskStatus) {
    const task = tasks.data?.find((item) => item.id === draggedTaskId);
    if (task && task.status !== status) {
      moveTask.mutate({ taskId: task.id, status });
    }
    handleDragEnd();
  }

  return (
    <main className={`board-page ${selected ? "has-drawer" : ""}`}>
      <section className="board-area">
        <header className="page-header">
          <div>
            <h1>Tasks</h1>
            <p>Sandboxed coding work with files, tools, and approvals</p>
          </div>
          <div className="header-actions">
            <button className="quiet-button" onClick={refresh}>
              Refresh
            </button>
            <button className="primary-button" onClick={() => setCreating(true)}>
              + New issue
            </button>
          </div>
        </header>
        {tasks.isLoading && <div className="loading">Loading board...</div>}
        {tasks.isError && (
          <div className="loading">
            Couldn't reach the board API. Check the api server and your sign-in.
          </div>
        )}
        <div className={`board ${draggedTaskId ? "dragging-card" : ""}`}>
          {STATUS_COLUMNS.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              label={column.label}
              selectedId={selectedId}
              draggedTaskId={draggedTaskId}
              dropTarget={dropStatus === column.status}
              tasks={(tasks.data ?? []).filter((task) => task.status === column.status)}
              showEmptyState={
                !tasks.isLoading && tasks.data?.length === 0 && column.status === "backlog"
              }
              onSelect={setSelectedId}
              onCardDragStart={handleDragStart}
              onCardDragEnd={handleDragEnd}
              onDragOver={setDropStatus}
              onDragLeave={(status) => {
                if (dropStatus === status) setDropStatus(null);
              }}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </section>
      {selected && (
        <TaskDrawer
          task={selected}
          users={users.data ?? []}
          onClose={() => setSelectedId(null)}
          onUpdate={(body) => update.mutate(body)}
          onComment={(body) => comment.mutate(body)}
          onFollowUp={(body) => followUp.mutate(body)}
          followUpPending={followUp.isPending}
        />
      )}
      {creating && (
        <CreateTaskModal
          users={users.data ?? []}
          submitting={createTask.isPending}
          onClose={() => setCreating(false)}
          onCreate={(payload) => createTask.mutate(payload)}
        />
      )}
      {message && (
        <button className="toast" onClick={() => setMessage("")}>
          {message}
        </button>
      )}
    </main>
  );
}
