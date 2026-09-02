import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api } from "../api/client";
import type { AgentProfile, Principal, ProjectRepoCatalogEntry } from "../api/types";

export function AgentsPage() {
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const profiles = useQuery({ queryKey: ["agent-profiles"], queryFn: api.agentProfiles });
  const repos = useQuery({ queryKey: ["project-repos"], queryFn: api.projectRepos });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Principal | null>(null);

  const createMutation = useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["assignees"] });
      setModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { displayName?: string; profileId?: string } }) =>
      api.updateAgent(id, body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["assignees"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-profile", vars.id] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAgent,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["assignees"] });
    },
  });

  return (
    <main className="agents-page">
      <header className="page-header agents-page-header">
        <div>
          <h1>Agents</h1>
          <p>
            Templates are blueprints. Registered agents below are the live assignees that can
            pick up tasks.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          New agent
        </button>
      </header>

      {agents.isLoading && <div className="loading">Loading agents...</div>}
      {agents.isError && (
        <div className="agent-empty">
          <h2>Could not load agents</h2>
          <p>{agents.error instanceof Error ? agents.error.message : "The board API did not return registered agents."}</p>
        </div>
      )}

      {(profiles.data ?? []).length > 0 && (
        <section className="profile-templates">
          <div className="profile-templates-head">
            <h2>Profile templates</h2>
            <p>Blueprints used when registering a board agent.</p>
          </div>
          <div className="profile-template-grid">
            {(profiles.data ?? []).map((profile) => (
              <article className="profile-template-card" key={profile.id}>
                <header>
                  <h3>{profile.id}</h3>
                  <span className="agent-hero-id">{profile.engine}</span>
                </header>
                {profile.description ? <p>{profile.description}</p> : null}
                <footer>
                  <span>{profile.runtime}</span>
                  {profile.model ? <span>{profile.model}</span> : null}
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {(agents.data ?? []).length > 0 && (
        <section className="agents-registered">
          <div className="profile-templates-head">
            <h2>Registered on this board</h2>
            <p>One card per live assignee.</p>
          </div>
          <div className="agents-grid">
            {(agents.data ?? []).map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                catalog={repos.data ?? []}
                onEdit={() => {
                  setEditing(agent);
                  setModalOpen(true);
                }}
                onDelete={() => {
                  if (window.confirm(`Delete agent ${agent.displayName}?`)) {
                    deleteMutation.mutate(agent.id);
                  }
                }}
              />
            ))}
          </div>
        </section>
      )}

      {!agents.isLoading && !agents.isError && (agents.data ?? []).length === 0 && (
        <div className="agent-empty">
          <h2>No agents registered</h2>
          <p>
            Profile templates can appear in the New agent dropdown even when this list is empty.
            Use New agent to register Coder, Reviewer, or Author, or restart <code>--role api</code>
            so the service can seed <code>agent-coder</code>, <code>agent-reviewer</code>, and{' '}
            <code>agent-author</code>.
          </p>
        </div>
      )}

      {modalOpen && (
        <AgentModal
          profiles={profiles.data ?? []}
          initial={editing}
          pending={createMutation.isPending || updateMutation.isPending}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSubmit={(body) => {
            if (editing) {
              updateMutation.mutate({ id: editing.id, body });
            } else {
              createMutation.mutate(body);
            }
          }}
        />
      )}
    </main>
  );
}

function AgentCard({
  agent,
  catalog,
  onEdit,
  onDelete,
}: {
  agent: Principal;
  catalog: ProjectRepoCatalogEntry[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const profile = useQuery({
    queryKey: ["agent-profile", agent.id],
    queryFn: () => api.agentProfile(agent.id),
  });
  const data = profile.data;
  const profileId = agent.title ?? agent.id;

  return (
    <article className="agent-card-v2">
      <div className="agent-hero">
        <span className="avatar agent-hero-avatar">{agent.avatarInitials}</span>
        <div className="agent-hero-text">
          <div className="agent-hero-name">
            <h2>{agent.displayName}</h2>
            <span className="status-pill succeeded agent-hero-active">Active</span>
          </div>
          <code className="agent-hero-id">{profileId}</code>
          {data?.description && <p className="agent-hero-desc">{data.description}</p>}
        </div>
        <div className="agent-card-actions">
          <button type="button" className="quiet-button" onClick={onEdit}>Edit</button>
          <button type="button" className="quiet-button danger" onClick={onDelete}>Delete</button>
        </div>
      </div>

      {profile.isLoading && !data && (
        <p className="agent-card-loading">Loading profile…</p>
      )}

      {data && (
        <>
          <section className="agent-section">
            <div className="agent-chip-row">
              <Chip label="Engine" value={data.engine} tone="accent" />
              <Chip label="Runtime" value={data.runtime} />
              {data.model && <Chip label="Model" value={data.model} />}
              {data.sandbox && <Chip label="Sandbox" value={data.sandbox} />}
            </div>
          </section>

          <section className="agent-section">
            <dl className="agent-policy-grid">
              <PolicyRow label="Approval" value={data.approvalPolicy ?? "—"} />
              <PolicyRow
                label="Budget"
                value={data.limits.maxRuntimeMinutes != null ? `${data.limits.maxRuntimeMinutes} min` : "—"}
              />
              <PolicyRow
                label="Tool cap"
                value={data.limits.maxToolCalls != null ? `${data.limits.maxToolCalls} calls` : "—"}
              />
              <PolicyRow
                label="Repos"
                value={
                  data.scope.allowedRepos.length > 0
                    ? `${data.scope.allowedRepos.length} allowed`
                    : "none"
                }
              />
            </dl>
          </section>

          <details className="agent-details">
            <summary>Repositories and guardrails</summary>
            <section className="agent-section">
              <h3 className="agent-section-title">Allowed repositories</h3>
              <ReposTable allowed={data.scope.allowedRepos} catalog={catalog} />
            </section>
            {(data.scope.pathDenylist.length > 0 || data.scope.egressAllowlist.length > 0) && (
              <section className="agent-section">
                <h3 className="agent-section-title">Additional guardrails</h3>
                <div className="agent-guardrails">
                  {data.scope.pathDenylist.length > 0 && (
                    <div>
                      <strong>Path denylist</strong>
                      <ul className="agent-tag-list">
                        {data.scope.pathDenylist.map((p) => (
                          <li key={p}><code>{p}</code></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {data.scope.egressAllowlist.length > 0 && (
                    <div>
                      <strong>Egress allowlist</strong>
                      <ul className="agent-tag-list">
                        {data.scope.egressAllowlist.map((p) => (
                          <li key={p}><code>{p}</code></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}
          </details>

          <footer className="agent-card-foot-v2">
            <div>
              <strong>Configuration</strong>
              <code>{data.configPath}</code>
            </div>
            <span className="agent-source-pill">
              {sourceLabel(data.source)}
            </span>
          </footer>
        </>
      )}
    </article>
  );
}

function AgentModal({
  profiles,
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  profiles: Array<{ id: string; description: string | null; engine: string; runtime: string }>;
  initial: Principal | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (body: { id?: string; displayName: string; profileId: string }) => void;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [profileId, setProfileId] = useState(initial?.title ?? profiles[0]?.id ?? "");
  const [agentId, setAgentId] = useState(initial?.id ?? "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim() || !profileId) return;
    onSubmit({
      id: initial ? undefined : agentId.trim() || undefined,
      displayName: displayName.trim(),
      profileId,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <header>
          <h2>{initial ? "Edit agent" : "New agent"}</h2>
          <button type="button" className="icon-button" onClick={onClose}>x</button>
        </header>
        {!initial && (
          <label>
            Agent id (optional)
            <input
              value={agentId}
              placeholder="agent-my-coder"
              onChange={(event) => setAgentId(event.target.value)}
            />
          </label>
        )}
        <label>
          Display name
          <input
            value={displayName}
            required
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          Profile template
          <select value={profileId} required onChange={(event) => setProfileId(event.target.value)}>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.id} · {profile.engine} / {profile.runtime}
              </option>
            ))}
          </select>
        </label>
        <footer>
          <button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={pending}>
            {pending ? "Saving…" : initial ? "Save changes" : "Create agent"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <span className={`agent-pill ${tone === "accent" ? "agent-pill-accent" : ""}`}>
      <span className="agent-pill-label">{label}</span>
      <span className="agent-pill-value">{value}</span>
    </span>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="agent-policy-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ReposTable({
  allowed,
  catalog,
}: {
  allowed: string[];
  catalog: ProjectRepoCatalogEntry[];
}) {
  const allowedSet = new Set(allowed);
  const catalogSlugs = catalog.map((r) => r.slug);
  const extras = allowed.filter((slug) => !catalogSlugs.includes(slug));

  if (catalog.length === 0 && allowed.length === 0) {
    return <p className="agent-section-hint">No repositories configured for this project.</p>;
  }

  return (
    <ul className="agent-repo-table">
      {catalog.map((repo) => {
        const enabled = allowedSet.has(repo.slug);
        return (
          <li key={repo.slug} className={`agent-repo-tr ${enabled ? "" : "blocked"}`}>
            <span className="agent-repo-cell agent-repo-cell-slug">
              <code>{repo.slug}</code>
              {repo.isDefault && <span className="agent-repo-default">project default</span>}
            </span>
            <span className="agent-repo-cell agent-repo-cell-meta">
              {repo.provider} · {repo.baseBranch}
            </span>
            <span className="agent-repo-cell agent-repo-cell-status">
              <span className={`status-pill ${enabled ? "succeeded" : "failed"}`}>
                {enabled ? "Allowed" : "Blocked"}
              </span>
            </span>
          </li>
        );
      })}
      {extras.map((slug) => (
        <li key={`extra-${slug}`} className="agent-repo-tr">
          <span className="agent-repo-cell agent-repo-cell-slug">
            <code>{slug}</code>
            <span className="agent-repo-default">not in project catalog</span>
          </span>
          <span className="agent-repo-cell agent-repo-cell-meta">—</span>
          <span className="agent-repo-cell agent-repo-cell-status">
            <span className="status-pill succeeded">Allowed</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function sourceLabel(source: AgentProfile["source"]): string {
  if (source === "repo-per-profile") return "Repo override";
  if (source === "repo-legacy") return "Repo legacy";
  return "Service default";
}

export type { AgentProfile };
