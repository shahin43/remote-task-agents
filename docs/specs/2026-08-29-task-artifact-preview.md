# Spec — Task-level artifact preview and end-to-end task-view hardening

Date: 2026-08-29
Status: **done** (live e2e PASS 2026-08-29) — **Phase 4** in the revised phasing (see product spec §6)
Parent: [2026-08-29-generic-open-source-service-spec.md](2026-08-29-generic-open-source-service-spec.md) §5.2 (snapshot & continuity)

## 1. Problem

Clicking a task today gives a snapshot *browser*, not a deliverable *view*:

- Artifacts are discovered by walking `workspace.tar` (`GET
  /api/snapshots/:ref/files`, group `artifacts`). Nothing durable records **which
  files the agent actually produced as deliverables** — not on `agent_runs`, not in
  `.agent/handoff.json`, not in task comments.
- The drawer's Preview tab guesses (all `artifacts/*.pdf`, then `summary.md` /
  first `*.md`, plus sidecars). An author run that writes three scratch files and
  one paper previews all of them equally.
- The default surface exposes the **whole workspace** (`repo/**`, `.agent/*`
  sidecars) to anyone who can open the task. For a deliverable-producing profile
  (author), the reader should see *the deliverables*, with whole-workspace browse
  as a secondary, deliberate action.
- Markdown renders as monospace `<pre>`; a business-paper artifact is unreadable
  as a preview.
- The live e2e gate asserts handoff and task status, but never that the produced
  artifacts are **viewable through the API** — the exact surface a human lands on.

## 2. Design

### 2.1 Artifact declaration (agent side)

The agent declares deliverables in a sidecar, same pattern as `handoff.json` —
the model writes intent; the harness validates and applies:

```
/workspace/.agent/artifacts.json
{
  "artifacts": [
    { "path": "artifacts/market-analysis.md", "title": "Market analysis", "primary": true },
    { "path": "artifacts/chart-revenue.svg", "title": "Revenue chart" }
  ]
}
```

- `path` must resolve **under `artifacts/`** (no traversal, no symlink escape) and
  must exist in the completion snapshot. Violations drop the entry with a task
  comment — never silently.
- Caps: max entries and max per-file preview size (server-configured, documented in
  `.env.example`).
- Profiles instruct the agent to write the manifest (base-prompt/AGENTS.md content
  change — layer 2/3, no new tool). The **platform AGENTS.md overlay** is prepended to
  every profile so this is not author-only. A capability-gated `publish_artifact` tool is
  an option later if prompting proves unreliable; not in this phase. Harness-managed
  git-diff preview for coder/reviewer is later.

### 2.2 Harness capture (durable record)

After the run, the applier (same pass that reads `handoff.json` / `mr-request.json`):

1. Parses + validates `.agent/artifacts.json` against the snapshot index.
2. **Fallback:** if absent, derives the list from `artifacts/**` in the snapshot,
   marked `declared: false` (backwards compatible; existing profiles keep working).
3. Persists the validated list on **`agent_runs.artifacts` (new JSONB column)** —
   per repo rule, run observability goes through `AgentRunsRepo`, not
   `sessions.metadata`.
4. Adds artifact links to the handoff task comment and to
   `task.metadata.handoffContext`.

### 2.3 Task-level API

```
GET /api/tasks/:id/artifacts
→ { taskId, artifacts: [ { path, title, primary, declared,
      attemptNumber, snapshotRefEncoded, previewUrl, downloadUrl } ] }
```

- Aggregated across attempts: **latest attempt wins per path**.
- `previewUrl` is the existing `GET /api/snapshots/:ref/file?path=…` (typed
  content, 2 MiB preview cap); `downloadUrl` adds `download=1`. The zip endpoint
  stays for "all artifacts".
- Reads only declared/derived artifact paths — this is the **viewer-scoped
  surface** the Phase 6 access layer will grant to the `viewer` role, while
  whole-workspace browse (`/files`, `workspace.tar`, `repo/**`) becomes
  `operator`+. Scoping groundwork lands now; role enforcement lands in Phase 6.

### 2.4 Board UI

- Task drawer: **Artifacts becomes the landing tab** when the task has artifacts
  (review/done states); driven by `GET /api/tasks/:id/artifacts`, not snapshot
  walking. `primary` artifact opens expanded.
- Rendering upgrades: markdown → sanitized HTML (headings, tables, images resolved
  against sibling artifact paths); images/SVG/PDF as today. No syntax
  highlighting/diff viewer in this phase.
- Files (whole workspace) and Runs tabs remain unchanged — demoted, not removed.
- Zero-repo tasks (author profile): hide the diff/repo groups entirely (closes
  product-spec open question 3).

### 2.5 End-to-end hardening

Extend `scripts/live-board-e2e.sh` (the regression gate):

- Author leg asserts `GET /api/tasks/:id/artifacts` returns ≥1 **declared** entry
  and each `previewUrl` serves 200 with the expected content type.
- Coder-reviewer leg asserts the git artifacts (`git/changes.patch`) remain
  reachable and the artifact list is empty-or-derived (no false declarations).
- `examples/02-research-paper/run.sh` gains the same assertion.

## 3. Exit criteria

1. Author run declares artifacts; task drawer opens on a rendered preview of the
   declared deliverables only; whole workspace requires an explicit tab switch.
2. `agent_runs` carries the validated artifact list; handoff comment links it.
3. Undeclared legacy runs still show derived artifacts (`declared: false`).
4. `bash scripts/live-board-e2e.sh` green including the new artifact assertions.

## 4. Non-goals

- Role enforcement (Phase 6 — this phase only shapes the scoped endpoint).
- Rich diff viewer, syntax highlighting, HTML-artifact sandboxed rendering.
- Artifact retention beyond existing snapshot retention env.
