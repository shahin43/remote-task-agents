import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";
import { relativeTime } from "../lib/status";

export function RunsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    refetchInterval: 4000,
  });

  const detail = useQuery({
    queryKey: ["session", selectedId],
    queryFn: () => api.session(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? 3000 : false,
  });

  return (
    <main className="runs-page">
      <div className="runs-list">
        {sessions.isLoading && <div className="loading">Loading runs...</div>}
        {sessions.isError && <div className="loading">Couldn't load sessions.</div>}
        {(sessions.data ?? []).map((session) => (
          <button
            key={session.id}
            className={`session-row ${selectedId === session.id ? "selected" : ""}`}
            onClick={() => setSelectedId(session.id)}
          >
            <div className="session-row-top">
              <span className="session-actor">{session.actor}</span>
              <span className={`status-pill ${session.status}`}>{session.status}</span>
            </div>
            <strong>{session.agentSpecId}</strong>
            <div>
              <small>
                {session.taskId ? `task ${session.taskId.slice(0, 8)} · ` : ""}
                {relativeTime(session.lastActivityAt)}
              </small>
            </div>
          </button>
        ))}
        {!sessions.isLoading && (sessions.data ?? []).length === 0 && (
          <div className="loading">No agent sessions yet.</div>
        )}
      </div>
      <div className="runs-detail">
        {!selectedId && <div className="empty-panel">Select a run to inspect its key events and logs.</div>}
        {selectedId && detail.data && (
          <>
            <h2>{detail.data.agentSpecId}</h2>
            <span className={`status-pill ${detail.data.status}`}>{detail.data.status}</span>
            <dl className="runs-meta">
              <dt>Session</dt>
              <dd>{detail.data.id}</dd>
              <dt>Actor</dt>
              <dd>{detail.data.actor}</dd>
              <dt>Channel</dt>
              <dd>{detail.data.channelOrigin ?? "—"}</dd>
              <dt>Parent</dt>
              <dd>{detail.data.parentSessionId ?? "—"}</dd>
              <dt>Opened</dt>
              <dd>{relativeTime(detail.data.openedAt)}</dd>
              <dt>Closed</dt>
              <dd>{detail.data.closedAt ? relativeTime(detail.data.closedAt) : "—"}</dd>
            </dl>
            <div className="event-feed">
              {detail.data.events.length === 0 && (
                <div className="event-line">
                  <span className="event-kind">—</span>
                  <span className="event-body">No events recorded yet.</span>
                  <span className="event-time" />
                </div>
              )}
              {detail.data.events.map((event) => (
                <div className="event-line" key={event.id}>
                  <span className="event-kind">{event.eventType}</span>
                  <span className="event-body">{event.body}</span>
                  <span className="event-time">{relativeTime(event.createdAt)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
