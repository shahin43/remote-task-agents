import type { AgentRun, TaskStatus } from "../api/types";

export const STATUS_COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "triaging", label: "Triaging" },
  { status: "working", label: "Working" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  triaging: "Triaging",
  working: "Working",
  review: "Review",
  done: "Done",
  failed: "Failed",
};

/** A run is "active" while routing (queued to a worker) or running. */
export function isRunActive(run: AgentRun): boolean {
  return run.status === "running" || run.status === "routing";
}

export function hasActiveRun(runs: AgentRun[]): boolean {
  return runs.some(isRunActive);
}

export function relativeTime(value: string): string {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const date = new Date(hasTimezone ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  const elapsed = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (elapsed < 60) return "Just now";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  if (elapsed < 172800) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
