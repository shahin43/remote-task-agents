import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";
import type { Task, Principal, SnapshotFileEntry, TaskArtifactView } from "../api/types";
import { hasActiveRun, relativeTime, STATUS_COLUMNS } from "../lib/status";
import { humanVisibleSnapshotFiles } from "../lib/board-files";
import { renderMarkdownPreview } from "../lib/markdown-preview";
import { AssigneeCombobox } from "./assignee-combobox";
import { MrRequestPanel } from "./mr-request-panel";

type Tab = "activity" | "output" | "files" | "preview" | "runs";

interface Props {
  task: Task;
  users: Principal[];
  onClose: () => void;
  onUpdate: (body: Record<string, unknown>) => void;
  onComment: (body: string) => void;
  onFollowUp: (body: { bodyMarkdown: string; resumeWorkspace: boolean }) => void;
  followUpPending?: boolean;
}

function activityText(eventType: string, payload: Record<string, unknown>): string {
  if (eventType === "task_created") return "Created this task.";
  if (eventType === "status_changed") return `Moved from ${payload.from} to ${payload.to}.`;
  if (eventType === "assignee_changed") {
    const to = payload.to as { id?: string } | null;
    return to ? `Assigned to ${to.id}.` : "Unassigned.";
  }
  if (eventType === "comment_added") return String(payload.text ?? "");
  return eventType.replaceAll("_", " ");
}

export function TaskDrawer({ task, users, onClose, onUpdate, onComment, onFollowUp, followUpPending }: Props) {
  const [tab, setTab] = useState<Tab>("activity");
  const [comment, setComment] = useState("");
  const [followUpText, setFollowUpText] = useState("");
  const [resumeWorkspace, setResumeWorkspace] = useState(false);
  useEffect(() => {
    setComment("");
    setFollowUpText("");
    setResumeWorkspace(false);
  }, [task.id]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const running = hasActiveRun(task.runs);

  // Live progress: poll the linked session's events while a run is active.
  const progress = useQuery({
    queryKey: ["task-progress", task.id],
    queryFn: () => api.taskProgress(task.id),
    refetchInterval: running ? 3000 : false,
  });

  const taskRuns = useQuery({
    queryKey: ["task-runs", task.id],
    queryFn: () => api.taskRuns(task.id),
    refetchInterval: running ? 5000 : false,
  });

  const taskUsage = useQuery({
    queryKey: ["task-usage", task.id],
    queryFn: () => api.taskUsage(task.id),
    refetchInterval: running ? 8000 : false,
  });

  const taskArtifacts = useQuery({
    queryKey: ["task-artifacts", task.id],
    queryFn: () => api.taskArtifacts(task.id),
    refetchInterval: running ? 8000 : false,
  });

  const landedFor = useRef<string | null>(null);
  useEffect(() => {
    if (taskArtifacts.isLoading) return;
    const settled = task.status === "review" || task.status === "done";
    const hasArts = (taskArtifacts.data?.artifacts ?? []).length > 0;
    const landKey = `${task.id}:${settled ? "settled" : "open"}:${hasArts ? "arts" : "none"}`;
    if (landedFor.current === landKey) return;
    landedFor.current = landKey;
    if (settled && hasArts) {
      setTab("preview");
      return;
    }
    if (settled) {
      setTab("files");
      return;
    }
    setTab("activity");
  }, [task.id, task.status, taskArtifacts.isLoading, taskArtifacts.data]);

  const attempts = taskRuns.data?.attempts ?? [];
  const [selectedAttempt, setSelectedAttempt] = useState<number>(1);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    const latest = attempts[attempts.length - 1]?.attemptNumber ?? 1;
    setSelectedAttempt(latest);
    setSelectedFile(null);
  }, [task.id, attempts.length]);

  const selectedAttemptView = attempts.find((a) => a.attemptNumber === selectedAttempt) ?? attempts[attempts.length - 1];
  const snapshotRef = selectedAttemptView?.snapshotRefEncoded ?? task.runs[0]?.lastSnapshotRefEncoded ?? null;

  const snapshotFiles = useQuery({
    queryKey: ["snapshot-files", snapshotRef],
    queryFn: () => api.snapshotFiles(snapshotRef!),
    enabled: Boolean(snapshotRef) && (tab === "files" || tab === "preview" || tab === "runs"),
  });
  const listedFiles = snapshotFiles.data?.files ?? [];
  const visibleFiles = humanVisibleSnapshotFiles(listedFiles);

  useEffect(() => {
    if (!snapshotFiles.data) return;
    const visible = humanVisibleSnapshotFiles(snapshotFiles.data.files);
    const patch = visible.find((file) => file.path === "git/changes.patch");
    setSelectedFile((prev) => {
      if (prev && visible.some((file) => file.path === prev)) return prev;
      return patch?.path ?? visible[0]?.path ?? null;
    });
  }, [snapshotRef, snapshotFiles.data]);

  const assignedAgent = task.assignee?.kind === "agent" ? task.assignee : null;
  const canFollowUp = Boolean(
    assignedAgent && (task.status === "review" || task.status === "failed"),
  );
  const agentRunInFlight = Boolean(
    assignedAgent && (task.status === "working" || task.status === "triaging" || running),
  );
  const [composerMode, setComposerMode] = useState<"agent" | "note">("agent");
  useEffect(() => setComposerMode("agent"), [task.id]);
  const latestRun = task.runs[0];
  const outputStatus = latestRun?.status.replaceAll("_", " ");
  const mrRequest = task.mrRequest;

  function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    onComment(comment);
    setComment("");
  }

  function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    if (!followUpText.trim()) return;
    onFollowUp({ bodyMarkdown: followUpText, resumeWorkspace });
    setFollowUpText("");
    setResumeWorkspace(false);
  }

  return (
    <aside className={tab === "files" || tab === "preview" ? "drawer drawer-wide" : "drawer"}>
      <header className="drawer-header">
        <div className="drawer-issue">{task.issueKey}</div>
        <div className="drawer-actions">
          <button className="icon-button" onClick={onClose}>
            x
          </button>
        </div>
        <h2>{task.title}</h2>
        {task.description && <p className="drawer-description">{task.description}</p>}
        {taskUsage.data && (taskUsage.data.totalTokens > 0 || taskUsage.data.costUsd != null) && (
          <p className="drawer-usage">
            Usage · {taskUsage.data.inputTokens} in / {taskUsage.data.outputTokens} out
            {taskUsage.data.costUsd != null ? ` · $${taskUsage.data.costUsd.toFixed(4)}` : ""}
            {` · ${taskUsage.data.attemptCount} attempt${taskUsage.data.attemptCount === 1 ? "" : "s"}`}
          </p>
        )}
      </header>
      <div className="property-list">
        <label>Status</label>
        <select value={task.status} onChange={(event) => onUpdate({ status: event.target.value })}>
          {STATUS_COLUMNS.map((status) => (
            <option value={status.status} key={status.status}>
              {status.label}
            </option>
          ))}
        </select>
        <label>Assignee</label>
        <AssigneeCombobox
          assignee={task.assignee}
          users={users}
          onSelect={(assigneeId) => onUpdate({ assigneeId })}
        />
        <label>Workspace</label>
        <code>{task.workspaceKey}</code>
        {task.repos.length > 0 && (
          <>
            <label>Repositories</label>
            <ul className="drawer-repo-list">
              {task.repos.map((slug) => (
                <li key={slug}>
                  <code>{slug}</code>
                  {slug === task.primaryRepo ? <span className="drawer-repo-primary">primary</span> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {mrRequest ? <MrRequestPanel taskId={task.id} mrRequest={mrRequest} /> : null}
      <nav className="drawer-tabs">
        {(["activity", "output", "runs", "files", "preview"] as Tab[]).map((item) => (
          <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>
            {item === "preview" ? "Artifacts" : item === "files" ? "Changes" : item[0]!.toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <div className="drawer-body">
        {tab === "activity" && (
          <>
            {assignedAgent ? (
              <section className="agent-composer">
                <header className="agent-composer-head">
                  <div className="agent-composer-id">
                    <span className="avatar agent-composer-avatar">
                      {assignedAgent.avatarInitials}
                    </span>
                    <div>
                      <strong>{assignedAgent.displayName}</strong>
                      <small>{assignedAgent.title ?? assignedAgent.id}</small>
                    </div>
                  </div>
                  <div className="agent-composer-mode" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={composerMode === "agent"}
                      className={composerMode === "agent" ? "active" : ""}
                      onClick={() => setComposerMode("agent")}
                    >
                      Send to agent
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={composerMode === "note"}
                      className={composerMode === "note" ? "active" : ""}
                      onClick={() => setComposerMode("note")}
                    >
                      Team note
                    </button>
                  </div>
                </header>

                {composerMode === "agent" ? (
                  agentRunInFlight ? (
                    <div className="agent-composer-busy">
                      <span className="agent-progress" aria-hidden="true" />
                      <div>
                        <strong>{assignedAgent.displayName} is working on this task.</strong>
                        <p>
                          Wait for the run to reach <em>review</em> or <em>failed</em> before sending a
                          follow-up. The Output tab shows live progress.
                        </p>
                      </div>
                    </div>
                  ) : canFollowUp ? (
                    <form className="agent-composer-form" onSubmit={submitFollowUp}>
                      <p className="composer-hint">
                        Reopens the run and sends your message to {assignedAgent.displayName}. The
                        agent replays prior conversation context.
                      </p>
                      <textarea
                        value={followUpText}
                        placeholder={`What should ${assignedAgent.displayName} do next?`}
                        onChange={(event) => setFollowUpText(event.target.value)}
                      />
                      <div className="agent-composer-actions">
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={resumeWorkspace}
                            onChange={(event) => setResumeWorkspace(event.target.checked)}
                          />
                          <span>
                            Restore workspace from last checkpoint
                            <small>Useful when continuing a coding task that wrote files.</small>
                          </span>
                        </label>
                        <button
                          className="primary-button"
                          type="submit"
                          disabled={followUpPending || !followUpText.trim()}
                        >
                          {followUpPending ? "Sending..." : "Send to agent"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="agent-composer-disabled">
                      Move this task to <strong>Review</strong> or <strong>Failed</strong> to send a
                      follow-up to the agent.
                    </div>
                  )
                ) : (
                  <form className="agent-composer-form" onSubmit={submitComment}>
                    <p className="composer-hint">
                      Visible on the board only — does <strong>not</strong> run the agent.
                    </p>
                    <textarea
                      value={comment}
                      placeholder="Note for humans on this task..."
                      onChange={(event) => setComment(event.target.value)}
                    />
                    <div className="agent-composer-actions">
                      <span />
                      <button
                        className="quiet-button"
                        type="submit"
                        disabled={!comment.trim()}
                      >
                        Add note
                      </button>
                    </div>
                  </form>
                )}
              </section>
            ) : (
              <form className="comment-form" onSubmit={submitComment}>
                <textarea
                  value={comment}
                  placeholder="Leave a comment..."
                  onChange={(event) => setComment(event.target.value)}
                />
                <button className="quiet-button" type="submit" disabled={!comment.trim()}>
                  Comment
                </button>
              </form>
            )}
            <div className="timeline">
              {task.activity.map((event) =>
                event.eventType === "comment_added" ? (
                  <div className="comment-row" key={event.id}>
                    <span className="avatar">{event.actor?.avatarInitials ?? "--"}</span>
                    <div className="comment-bubble">
                      <header>
                        <strong>{event.actor?.displayName ?? "System"}</strong>
                        <small>{relativeTime(event.createdAt)}</small>
                      </header>
                      <p>{activityText(event.eventType, event.payload)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="activity-row" key={event.id}>
                    <span className="activity-dot" />
                    <p>
                      <span>{event.actor?.displayName ?? "System"}</span>{" "}
                      {activityText(event.eventType, event.payload)}
                    </p>
                    <small>{relativeTime(event.createdAt)}</small>
                  </div>
                ),
              )}
            </div>
          </>
        )}
        {tab === "output" && (
          <section className="output-panel">
            <header className="output-header">
              <span>Task output</span>
              {running ? (
                <small className="output-status running">
                  <span className="agent-progress" aria-hidden="true" />
                  Running
                </small>
              ) : latestRun ? (
                <small className={`output-status ${latestRun.status}`}>{outputStatus}</small>
              ) : null}
            </header>
            {progress.data && progress.data.events.length > 0 ? (
              <div className="output-feed">
                {running && <div className="output-cursor">Working...</div>}
                {progress.data.events.map((event) => (
                  <div className="output-line" key={event.id}>
                    <small>{relativeTime(event.createdAt)}</small>
                    <pre>
                      <strong>{event.eventType}</strong>
                      {event.body ? `\n${event.body}` : ""}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-panel">
                Assign an agent to dispatch a sandboxed run; its live progress and key events appear
                here.
              </div>
            )}
          </section>
        )}
        {tab === "runs" && (
          <section className="runs-panel">
            {latestRun?.currentAttempt && (
              <div className="live-sandbox-banner">
                <strong>Live attempt #{latestRun.currentAttempt.attemptNumber} · {latestRun.currentAttempt.status}</strong>
                <dl>
                  {latestRun.currentAttempt.sandboxSessionId && (
                    <>
                      <dt>Sandbox session</dt>
                      <dd>
                        <code title={latestRun.currentAttempt.sandboxSessionId}>
                          {latestRun.currentAttempt.sandboxSessionId.slice(0, 8)}
                        </code>
                      </dd>
                    </>
                  )}
                  {latestRun.currentAttempt.containerId && (
                    <>
                      <dt>Container</dt>
                      <dd>
                        <code title={latestRun.currentAttempt.containerId}>
                          {latestRun.currentAttempt.containerId.slice(0, 12)}
                        </code>
                      </dd>
                    </>
                  )}
                  {latestRun.currentAttempt.backend && (
                    <>
                      <dt>Backend</dt>
                      <dd>{latestRun.currentAttempt.backend}</dd>
                    </>
                  )}
                  <dt>Started</dt>
                  <dd>{relativeTime(latestRun.currentAttempt.startedAt)}</dd>
                </dl>
              </div>
            )}
            {attempts.length === 0 ? (
              <div className="empty-panel">No agent runs yet. Assign an agent to start a run.</div>
            ) : (
              attempts.map((attempt) => (
                <details className="run-attempt" key={attempt.attemptNumber} open={attempt.attemptNumber === attempts.length}>
                  <summary>
                    Attempt {attempt.attemptNumber} · {attempt.status}
                    {attempt.endedAt ? ` · ${relativeTime(attempt.endedAt)}` : ""}
                    {attempt.durationMs != null ? ` · ${(attempt.durationMs / 1000).toFixed(1)}s` : ""}
                    {attempt.tokenUsage && typeof attempt.tokenUsage.input === "number"
                      ? ` · ${attempt.tokenUsage.input}+${typeof attempt.tokenUsage.output === "number" ? attempt.tokenUsage.output : 0} tok`
                      : ""}
                  </summary>
                  {(attempt.sandboxSessionId || attempt.backend) && (
                    <div className="run-meta">
                      {attempt.backend && <span><strong>Backend</strong> {attempt.backend}</span>}
                      {attempt.sandboxSessionId && (
                        <span>
                          <strong>Sandbox</strong>
                          <code title={attempt.sandboxSessionId}>{attempt.sandboxSessionId.slice(0, 8)}</code>
                        </span>
                      )}
                      {attempt.containerId && (
                        <span>
                          <strong>Container</strong>
                          <code title={attempt.containerId}>{attempt.containerId.slice(0, 12)}</code>
                        </span>
                      )}
                    </div>
                  )}
                  {attempt.priorSummary && (
                    <div className="run-input-block">
                      <strong>Prior summary injected</strong>
                      <pre>{attempt.priorSummary}</pre>
                    </div>
                  )}
                  {attempt.channelInputs.map((input, idx) => (
                    <div className="run-input-block" key={`${attempt.attemptNumber}-in-${idx}`}>
                      <strong>User input {attempt.channelInputs.length > 1 ? idx + 1 : ""}</strong>
                      <pre>{input}</pre>
                    </div>
                  ))}
                  {attempt.agentSummary && (
                    <div className="run-input-block">
                      <strong>Agent summary</strong>
                      <pre>{attempt.agentSummary}</pre>
                    </div>
                  )}
                  {attempt.error && (
                    <div className="run-input-block error">
                      <strong>Error</strong>
                      <pre>{attempt.error}</pre>
                    </div>
                  )}
                  {attempt.snapshotRefEncoded && (
                    <RunSnapshotOutputs encodedRef={attempt.snapshotRefEncoded} />
                  )}
                </details>
              ))
            )}
          </section>
        )}
        {tab === "files" && (
          <section className="files-panel">
            {attempts.length > 0 && (
              <label className="attempt-select">
                Attempt
                <select
                  value={selectedAttempt}
                  onChange={(event) => {
                    setSelectedAttempt(Number(event.target.value));
                    setSelectedFile(null);
                  }}
                >
                  {attempts.filter((a) => a.snapshotRefEncoded).map((attempt) => (
                    <option value={attempt.attemptNumber} key={attempt.attemptNumber}>
                      #{attempt.attemptNumber} · {attempt.status}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!snapshotRef ? (
              <div className="empty-panel">No snapshot yet for this task.</div>
            ) : snapshotFiles.isLoading ? (
              <div className="loading">Loading snapshot files…</div>
            ) : visibleFiles.length === 0 ? (
              <div className="empty-panel">No human-visible files in this snapshot.</div>
            ) : (
              <div className="files-layout">
                <div className="file-tree-wrap">
                  <SnapshotDownloadBar encodedRef={snapshotRef} files={listedFiles} />
                  <GroupedFileTree
                    encodedRef={snapshotRef}
                    files={visibleFiles}
                    selectedFile={selectedFile}
                    onSelect={setSelectedFile}
                  />
                </div>
                <div className="file-viewer preview-card">
                  {!selectedFile ? (
                    <div className="empty-panel">Select a file to preview.</div>
                  ) : (
                    <TypedFilePreview encodedRef={snapshotRef} filePath={selectedFile} />
                  )}
                </div>
              </div>
            )}
          </section>
        )}
        {tab === "preview" && (
          <section className="preview-panel">
            {taskArtifacts.isLoading ? (
              <div className="loading">Loading artifacts…</div>
            ) : (taskArtifacts.data?.artifacts ?? []).length === 0 ? (
              <div className="empty-panel">No declared or derived artifacts for this task.</div>
            ) : (
              <ArtifactReader artifacts={taskArtifacts.data!.artifacts} />
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function previewKind(filePath: string): "pdf" | "image" | "text" | "download" {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["md", "txt", "csv", "json", "yaml", "yml", "sql", "py", "sh", "js", "mjs", "ts", "patch", "html"].includes(ext)) {
    return "text";
  }
  return "download";
}

const GROUP_ORDER = ["key", "artifacts", "git", "repo"] as const;
const GROUP_LABELS: Record<(typeof GROUP_ORDER)[number], string> = {
  key: "Key files",
  artifacts: "Artifacts",
  git: "Changes",
  repo: "Repository",
};

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ArtifactsZipButton({ encodedRef, files }: { encodedRef: string; files: SnapshotFileEntry[] }) {
  const hasArtifacts = files.some((f) => f.group === "artifacts" || f.path.startsWith("artifacts/"));
  if (!hasArtifacts) return null;
  return (
    <button
      type="button"
      className="download-btn"
      onClick={async () => {
        const zip = await api.snapshotArtifactsZip(encodedRef);
        await saveBlob(zip.blob, zip.filename);
      }}
    >
      Download artifacts
    </button>
  );
}

function WorkspaceTarButton({ encodedRef }: { encodedRef: string }) {
  return (
    <button
      type="button"
      className="download-btn"
      onClick={async () => {
        const archive = await api.snapshotWorkspaceTar(encodedRef);
        await saveBlob(archive.blob, archive.filename);
      }}
    >
      Download workspace
    </button>
  );
}

function SnapshotDownloadBar({ encodedRef, files }: { encodedRef: string; files: SnapshotFileEntry[] }) {
  return (
    <div className="snapshot-download-bar">
      <ArtifactsZipButton encodedRef={encodedRef} files={files} />
      <WorkspaceTarButton encodedRef={encodedRef} />
    </div>
  );
}

async function downloadSnapshotFile(encodedRef: string, filePath: string) {
  const downloaded = await api.snapshotFileBytes(encodedRef, filePath, true);
  await saveBlob(downloaded.blob, downloaded.filename);
}

function fileTreeLabel(group: (typeof GROUP_ORDER)[number], path: string): string {
  if (group === "repo") return path.replace(/^repo\//, "");
  if (group === "artifacts") return path.replace(/^artifacts\//, "");
  if (group === "git") return path.replace(/^git\//, "");
  return path;
}

function FileDownloadIcon({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="file-dl-icon"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 1.5a.75.75 0 0 1 .75.75v6.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 1.06-1.06l1.72 1.72V2.25A.75.75 0 0 1 8 1.5Zm-4.5 9a.75.75 0 0 1 .75.75v1.5h7.5v-1.5a.75.75 0 0 1 1.5 0v2.25c0 .41-.34.75-.75.75h-9a.75.75 0 0 1-.75-.75V11.25a.75.75 0 0 1 .75-.75Z"
        />
      </svg>
    </button>
  );
}

function GroupedFileTree({
  encodedRef,
  files,
  selectedFile,
  onSelect,
}: {
  encodedRef: string;
  files: SnapshotFileEntry[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="file-tree-groups">
      {GROUP_ORDER.map((group) => {
        const items = files.filter((f) => (f.group ?? inferGroup(f.path)) === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="file-group">
            <h4>{GROUP_LABELS[group]}</h4>
            <ul className="file-tree">
              {items.map((file) => {
                const label = fileTreeLabel(group, file.path);
                return (
                  <li key={file.path} className={selectedFile === file.path ? "file-tree-row active" : "file-tree-row"}>
                    <button
                      type="button"
                      className="file-tree-name"
                      title={file.path}
                      onClick={() => onSelect(file.path)}
                    >
                      <span>{label}</span>
                    </button>
                    <FileDownloadIcon
                      label={`Download ${label}`}
                      onClick={() => void downloadSnapshotFile(encodedRef, file.path)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RunSnapshotOutputs({ encodedRef }: { encodedRef: string }) {
  const files = useQuery({
    queryKey: ["snapshot-files", encodedRef],
    queryFn: () => api.snapshotFiles(encodedRef),
  });
  const listed = files.data?.files ?? [];
  const artifacts = listed.filter((f) => (f.group ?? inferGroup(f.path)) === "artifacts");

  return (
    <div className="run-snapshot-outputs">
      <p className="run-snapshot-link">
        Snapshot: <code>{encodedRef}</code>
      </p>
      <SnapshotDownloadBar encodedRef={encodedRef} files={listed} />
      {files.isLoading ? (
        <div className="loading">Listing artifacts…</div>
      ) : artifacts.length === 0 ? (
        <p className="run-snapshot-empty">No files under artifacts/ in this snapshot.</p>
      ) : (
        <ul className="run-artifact-list">
          {artifacts.map((file) => {
            const label = file.path.replace(/^artifacts\//, "");
            return (
              <li key={file.path}>
                <code title={file.path}>{label}</code>
                {file.bytes != null ? <small>{file.bytes} B</small> : null}
                <FileDownloadIcon
                  label={`Download ${label}`}
                  onClick={() => void downloadSnapshotFile(encodedRef, file.path)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function inferGroup(path: string): SnapshotFileEntry["group"] {
  if (path.startsWith("artifacts/")) return "artifacts";
  if (path.startsWith("repo/")) return "repo";
  if (path.startsWith("git/")) return "git";
  return "key";
}

function TypedFilePreview({
  encodedRef,
  filePath,
  title,
  previewUrl,
}: {
  encodedRef: string;
  filePath: string;
  title?: string;
  previewUrl?: string;
}) {
  const kind = previewKind(filePath);
  const file = useQuery({
    queryKey: ["snapshot-file-bytes", encodedRef, filePath],
    queryFn: () => api.snapshotFileBytes(encodedRef, filePath),
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.data) return;
    const url = URL.createObjectURL(file.data.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file.data]);
  const openHref =
    previewUrl ??
    `/api/snapshots/${encodeURIComponent(encodedRef)}/file?path=${encodeURIComponent(filePath)}`;

  if (file.isLoading) return <div className="loading">Loading file…</div>;
  if (file.isError || !file.data) return <div className="empty-panel">Could not load this file.</div>;

  return (
    <div className="typed-preview">
      <div className="preview-toolbar">
        <div className="preview-toolbar-meta">
          {title ? <strong>{title}</strong> : null}
          <code>{filePath}</code>
        </div>
        <div className="preview-toolbar-actions">
          <a className="download-btn" href={openHref} target="_blank" rel="noreferrer">
            Open
          </a>
          <button
            type="button"
            className="download-btn"
            onClick={async () => {
              const downloaded = await api.snapshotFileBytes(encodedRef, filePath, true);
              await saveBlob(downloaded.blob, downloaded.filename);
            }}
          >
            Download
          </button>
        </div>
      </div>
      {kind === "pdf" && objectUrl && (
        <iframe className="pdf-frame" title={filePath} src={objectUrl} />
      )}
      {kind === "image" && objectUrl && <img className="preview-image" alt={filePath} src={objectUrl} />}
      {kind === "text" && filePath.endsWith(".md") && (
        <MarkdownPreview blob={file.data.blob} filePath={filePath} encodedRef={encodedRef} />
      )}
      {kind === "text" && !filePath.endsWith(".md") && <TextPreview blob={file.data.blob} path={filePath} />}
      {kind === "download" && <div className="empty-panel">This file type opens via Download.</div>}
    </div>
  );
}

function TextPreview({ blob, path }: { blob: Blob; path: string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    void blob.text().then(setText);
  }, [blob]);
  if (path.endsWith(".json")) {
    try {
      return <pre>{JSON.stringify(JSON.parse(text), null, 2)}</pre>;
    } catch {
      return <pre>{text}</pre>;
    }
  }
  return <pre>{text}</pre>;
}

function MarkdownPreview({
  blob,
  filePath,
  encodedRef,
}: {
  blob: Blob;
  filePath: string;
  encodedRef: string;
}) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    void blob.text().then((md) => {
      const slash = filePath.lastIndexOf("/");
      const dir = slash >= 0 ? filePath.slice(0, slash) : "";
      setHtml(
        renderMarkdownPreview(md, {
          resolveSrc: (src) => {
            if (/^https?:\/\//i.test(src) || src.startsWith("/")) return src;
            const rel = src.replace(/^\.\//, "");
            const sibling = dir ? `${dir}/${rel}` : rel;
            return `/api/snapshots/${encodeURIComponent(encodedRef)}/file?path=${encodeURIComponent(sibling)}`;
          },
        }),
      );
    });
  }, [blob, filePath, encodedRef]);
  return <div className="md-preview-host" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ArtifactReader({ artifacts }: { artifacts: TaskArtifactView[] }) {
  const initial = artifacts.find((artifact) => artifact.primary) ?? artifacts[0]!;
  const [selectedKey, setSelectedKey] = useState(`${initial.attemptNumber}:${initial.path}`);
  useEffect(() => {
    setSelectedKey((prev) => {
      if (artifacts.some((artifact) => `${artifact.attemptNumber}:${artifact.path}` === prev)) {
        return prev;
      }
      const next = artifacts.find((artifact) => artifact.primary) ?? artifacts[0];
      return next ? `${next.attemptNumber}:${next.path}` : prev;
    });
  }, [artifacts]);
  const selected =
    artifacts.find((artifact) => `${artifact.attemptNumber}:${artifact.path}` === selectedKey) ?? initial;

  return (
    <div className={artifacts.length > 1 ? "artifact-reader artifact-reader--multi" : "artifact-reader"}>
      {artifacts.length > 1 ? (
        <ul className="artifact-chips">
          {artifacts.map((artifact) => {
            const key = `${artifact.attemptNumber}:${artifact.path}`;
            const active = key === selectedKey;
            return (
              <li key={key}>
                <button
                  type="button"
                  className={active ? "artifact-chip active" : "artifact-chip"}
                  title={artifact.path}
                  onClick={() => setSelectedKey(key)}
                >
                  <span>{artifact.title}</span>
                  <small>
                    {artifact.path.replace(/^artifacts\//, "")}
                    {artifact.declared ? "" : " · derived"}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="preview-card">
        {selected.snapshotRefEncoded ? (
          <TypedFilePreview
            encodedRef={selected.snapshotRefEncoded}
            filePath={selected.path}
            title={selected.title}
            previewUrl={selected.previewUrl}
          />
        ) : (
          <div className="empty-panel">No snapshot for {selected.path}.</div>
        )}
      </div>
    </div>
  );
}
