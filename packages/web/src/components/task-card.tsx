import type { DragEvent } from "react";

import type { Task } from "../api/types";
import { mrCardBadgeText, mrNeedsApproval } from "../lib/mr-request";
import { hasActiveRun } from "../lib/status";

interface Props {
  task: Task;
  selected: boolean;
  dragging: boolean;
  onSelect: (taskId: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, task: Task) => void;
  onDragEnd: () => void;
}

export function TaskCard({ task, selected, dragging, onSelect, onDragStart, onDragEnd }: Props) {
  const running = hasActiveRun(task.runs);
  const mr = task.mrRequest;
  const mrBadge = mr ? mrCardBadgeText(mr) : "";
  const mrPending = mrNeedsApproval(mr);

  return (
    <button
      className={`task-card ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${mrPending ? "task-card--mr-pending" : ""}`}
      draggable
      onClick={() => onSelect(task.id)}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
    >
      <span className="issue-key">{task.issueKey}</span>
      {mrBadge ? (
        <span className={`task-mr-badge task-mr-badge--${mr!.status}`} title={mr!.title}>
          {mrBadge}
        </span>
      ) : null}
      <strong>{task.title}</strong>
      <div className="card-meta">
        <span className="card-avatar">{task.assignee?.avatarInitials ?? "--"}</span>
        <label>{task.assignee?.displayName ?? "Unassigned"}</label>
        {running && (
          <span className="agent-progress" aria-label="Agent running" title="Agent running" />
        )}
        <small>{task.runs.length} runs</small>
      </div>
    </button>
  );
}
