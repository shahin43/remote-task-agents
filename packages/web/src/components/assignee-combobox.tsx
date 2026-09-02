import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Principal } from "../api/types";

interface Props {
  assignee: Principal | null;
  users: Principal[];
  onSelect: (assigneeId: string | null) => void;
  variant?: "drawer" | "composer";
}

export function AssigneeCombobox({ assignee, users, onSelect, variant = "drawer" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = assignee?.displayName ?? "Unassigned";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const options: Array<{ id: string | null; label: string; detail?: string | null }> = [
    { id: null, label: "Unassigned" },
    ...users.map((user) => ({
      id: user.id,
      label: user.displayName,
      detail: user.kind === "agent" ? `agent · ${user.title ?? ""}` : user.title,
    })),
  ];
  const filter = open && query === selectedLabel ? "" : query.trim().toLowerCase();
  const filtered = options.filter(
    (option) =>
      !filter ||
      option.label.toLowerCase().includes(filter) ||
      option.detail?.toLowerCase().includes(filter),
  );

  useEffect(() => setQuery(selectedLabel), [selectedLabel]);
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selectedLabel);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [selectedLabel]);

  function choose(option: (typeof options)[number]) {
    setQuery(option.label);
    setOpen(false);
    onSelect(option.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery(selectedLabel);
    }
  }

  return (
    <div
      className={`assignee-combobox ${variant === "composer" ? "composer-assignee" : ""}`}
      ref={rootRef}
    >
      <input
        aria-label="Assignee"
        aria-expanded={open}
        aria-haspopup="listbox"
        autoComplete="off"
        className="assignee-input"
        role="combobox"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={(event) => {
          setOpen(true);
          setActiveIndex(0);
          event.target.select();
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div className="assignee-options" role="listbox">
          {filtered.length ? (
            filtered.map((option, index) => (
              <button
                className={`assignee-option ${index === activeIndex ? "active" : ""}`}
                key={option.id ?? "unassigned"}
                role="option"
                type="button"
                aria-selected={option.id === (assignee?.id ?? null)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.detail && <small>{option.detail}</small>}
              </button>
            ))
          ) : (
            <span className="assignee-empty">No matching assignees</span>
          )}
        </div>
      )}
    </div>
  );
}
