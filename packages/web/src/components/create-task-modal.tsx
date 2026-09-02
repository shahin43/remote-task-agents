import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";
import type { Principal } from "../api/types";
import { AssigneeCombobox } from "./assignee-combobox";
import { RepoPicker } from "./repo-picker";

interface Props {
  users: Principal[];
  submitting: boolean;
  onClose: () => void;
  onCreate: (payload: {
    title: string;
    description: string;
    sessionName: string;
    assigneeId: string | null;
    repos: string[];
    primaryRepo: string | null;
  }) => void;
}

export function CreateTaskModal({ users, submitting, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sessionName, setSessionName] = useState("Agent coding workflow");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);

  const catalogQuery = useQuery({
    queryKey: ["project-repos"],
    queryFn: api.projectRepos,
  });

  const defaultRepos = useMemo(
    () => catalogQuery.data?.filter((r) => r.isDefault).map((r) => r.slug)
      ?? catalogQuery.data?.map((r) => r.slug)
      ?? [],
    [catalogQuery.data],
  );

  useEffect(() => {
    if (defaultRepos.length > 0 && selectedRepos.length === 0) {
      setSelectedRepos(defaultRepos);
    }
  }, [defaultRepos, selectedRepos.length]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate({
      title,
      description,
      sessionName,
      assigneeId,
      repos: selectedRepos,
      primaryRepo: selectedRepos[0] ?? null,
    });
  }

  function submitWithShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="task-modal" onSubmit={submit} onKeyDown={submitWithShortcut}>
        <header className="composer-header">
          <div className="composer-context">
            <span className="composer-context-pill">Agent Board</span>
            <span className="composer-divider">/</span>
            <span className="composer-context-pill">Task</span>
          </div>
          <button type="button" className="composer-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <section className="composer-body">
          <input
            className="composer-title"
            autoFocus
            required
            placeholder="Issue title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className="composer-description"
            placeholder="Add description..."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </section>
        <div className="composer-properties">
          <span className="composer-pill">○ Backlog</span>
          <AssigneeCombobox
            assignee={users.find((user) => user.id === assigneeId) ?? null}
            users={users}
            onSelect={setAssigneeId}
            variant="composer"
          />
          <label className="composer-pill composer-session">
            <span>Session</span>
            <input
              aria-label="Session"
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
            />
          </label>
        </div>
        {catalogQuery.data && catalogQuery.data.length > 0 && (
          <section className="composer-repos">
            <h3>Repositories</h3>
            <RepoPicker
              catalog={catalogQuery.data}
              selected={selectedRepos}
              onChange={setSelectedRepos}
            />
          </section>
        )}
        <footer className="composer-footer">
          <div className="composer-files">
            <span className="composer-drop-hint">
              Assign an agent to dispatch this task to a sandboxed run.
            </span>
          </div>
          <button type="button" className="quiet-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create issue"} {!submitting && <kbd>⌘↵</kbd>}
          </button>
        </footer>
      </form>
    </div>
  );
}
