# Done — Phase 4: task artifact preview + task-view hardening

Spec: [2026-08-29-task-artifact-preview.md](../../specs/2026-08-29-task-artifact-preview.md)
Plan: [2026-08-29-task-artifact-preview.md](../../superpowers/plans/2026-08-29-task-artifact-preview.md)

Exit: task drawer opens on rendered declared artifacts only; e2e asserts artifact
previews via API.

Live e2e **PASS** `scripts/live-board-e2e.sh` 2026-08-29 (`legs=all`):
author `b6bb6e93-baa8-4432-8e1f-e8de8eb1c8eb` declared `artifacts/sandbox-agents.md`,
preview HTTP 200 `text/markdown`. Coder/reviewer declared none.

## Checklist

- [x] `.agent/artifacts.json` sidecar: applier parse + validate (under `artifacts/`, exists in snapshot, caps)
- [x] Fallback derivation from `artifacts/**` for undeclared runs (`declared: false`)
- [x] `agent_runs.artifacts` JSONB column via `AgentRunsRepo` (+ migration)
- [x] Artifact links in handoff comment + `handoffContext`
- [x] `GET /api/tasks/:id/artifacts` — aggregated, latest attempt wins per path
- [x] Drawer: Artifacts landing tab from the new API; `primary` opens expanded
- [x] Markdown → sanitized HTML preview (relative images resolved)
- [x] Hide diff/repo groups for zero-repo tasks
- [x] Platform AGENTS.md overlay instructs every agent to declare preview deliverables
- [x] `live-board-e2e.sh` asserts declared artifacts preview (200 + content type)
- [x] Follow-on board SPA (document reader, Changes filter, status grid, Agents listing) — [board-spa-task-view.md](board-spa-task-view.md)

## Notes

- Preview instructions are **platform-wide** (`composeWorkspaceAgentsMd`), not author-only.
  Coder/reviewer git-diff viewer is later; omit the sidecar when the run only edits `repo/`.
- Live Docker uses `PiRunnerEngineAdapter` (not `runIsolatedAgent`); capture runs after
  either path. Sidecar parse accepts `previewDeliverables` / truncated JSON repair.
- Board UI after the API landed: Artifacts is a document reader; Changes hides harness
  paths; columns are a 6-up grid with a light stipple and a terracotta accent. Details in
  [board-spa-task-view.md](board-spa-task-view.md).
