# Development guidelines and progress

This is the **development guide** for `remote-sandbox-agents`: how we work, which
specs are canonical, and where progress lives. The docs landing page is
[docs/README.md](docs/README.md) (how agents pick work, checks, specs, papers).
Checklists in `docs/tasks/` must stay in sync with the table below. Session notes
go in `docs/session-handoff/`.

## Canonical docs (read in this order)

| Doc | Role |
|---|---|
| [docs/README.md](docs/README.md) | Docs index: pick work, checks, specs, tracker, papers |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mental model, planes, sandbox SPI, skills |
| [docs/specs/2026-08-29-generic-open-source-service-spec.md](docs/specs/2026-08-29-generic-open-source-service-spec.md) | Product spec (§6 phasing is the roadmap) |
| [docs/specs/2026-08-29-task-artifact-preview.md](docs/specs/2026-08-29-task-artifact-preview.md) | Phase 4 spec (artifact preview, task-view hardening) |
| [docs/specs/2026-08-29-chat-orchestration.md](docs/specs/2026-08-29-chat-orchestration.md) | Phase 5 PRD/delivery spec (chat, durable SSE, project orchestrator) |
| [docs/specs/2026-08-31-durable-agent-coordination-and-handoffs.md](docs/specs/2026-08-31-durable-agent-coordination-and-handoffs.md) | Phase 5B companion spec (durable profiles/sessions, delegation, child return, typed handoff) |
| [docs/specs/2026-08-29-port-from-dns-remote-agent.md](docs/specs/2026-08-29-port-from-dns-remote-agent.md) | Phase 0 keep/drop (historical) |
| [AGENTS.md](AGENTS.md) | Agent/operator conventions, commands, env, e2e gate |
| [docs/tasks/README.md](docs/tasks/README.md) | Live checklists (`done/` / `in-progress/` / `later/`) |

Do not treat sibling `dns-remote-agent` as a source of truth for this repo. Port from
it; never modify it from this workspace.

## How the service runs today

| Piece | Where it runs |
|---|---|
| Postgres | Docker Compose (`docker compose up postgres -d`, host port **5433**) |
| API + control + worker (local e2e) | **One Node process on the host**: `--role api --with-worker` |
| Production-shaped split | Three processes or compose services: `--role api`, `--role control`, `--role worker` |
| Agent sandbox | **`sandbox-docker`** by default (Pi runner inside `remote-sandbox-agents/pi-agent:local`) |
| Snapshots | Local disk only (`REMOTE_AGENT_SNAPSHOT_STORE=local`) |

Compose `api` / `control` / `worker` services exist for a split deploy. The proven
live loop is host Node + Docker sandboxes. A compose `worker` needs a Docker socket
(and the docker-CLI image) to nest `sandbox-docker`; that is not required for the
laptop e2e.

`sandbox-unix-local` is for tests and trusted local runs (no isolation). Lambda,
Modal, Daytona, Firecracker, etc. are **not** in-tree — see
[docs/tasks/later/sandbox-provider-extensions.md](docs/tasks/later/sandbox-provider-extensions.md).

## Spec progress (keep in sync with `docs/tasks/`)

| Phase | Spec | Status | Tracker |
|---|---|---|---|
| 0 | Mechanical port + LICENSE | **Done** — live e2e PASS 2026-08-29 | [done/phase-0](docs/tasks/done/phase-0-generic-port.md) |
| 1 | Examples + snapshot retention | **Done** (scripts); leftover live 03/04 | [done/phase-1](docs/tasks/done/phase-1-examples-and-snapshots.md) |
| 2 | Agent config API (profiles) | **Done** (API + tests); leftover live curl | [done/phase-2](docs/tasks/done/phase-2-agent-config-api.md) |
| 3 | Promotion + cycle cap + cost | **Done** | [done/phase-3](docs/tasks/done/phase-3-cycle-cap-and-cost.md) |
| 4 | Task artifact preview + task-view hardening ([spec](docs/specs/2026-08-29-task-artifact-preview.md)) | **Done** — live e2e PASS 2026-08-29 | [done/phase-4](docs/tasks/done/phase-4-artifact-preview.md) |
| — | Board SPA follow-on (reader, Changes, 6-up grid, Agents listing) | **Done** 2026-08-29 | [done/board-spa](docs/tasks/done/board-spa-task-view.md) |
| 5 | Chat + durable SSE + direct/profile chat + project orchestrator ([spec](docs/specs/2026-08-29-chat-orchestration.md)) | Later (draft expanded; review decisions pending) | [later/phase-5](docs/tasks/later/phase-5-chat-and-orchestration.md) |
| 5B | Durable agent coordination + handoffs ([spec](docs/specs/2026-08-31-durable-agent-coordination-and-handoffs.md)) | Later (companion draft; after/alongside Phase 5A foundations) | [later/phase-5b](docs/tasks/later/phase-5b-durable-agent-coordination.md) |
| 6 | Access layer (server-side actor, OIDC, roles) | Later | [later/phase-6](docs/tasks/later/phase-6-access-layer.md) |
| 7 | Agent-config UI over the Phase 2 API | Later (listing shipped; editor not) | [later/phase-7](docs/tasks/later/phase-7-agent-config-ui.md) |
| 8+ | Out-of-tree sandbox SPI, skill upload, notifications, tenancy | Later | [later/sandbox SPI](docs/tasks/later/sandbox-provider-extensions.md), [later/phase-8+](docs/tasks/later/phase-8-plus.md) |

Phases 4–8 were reordered on 2026-08-29 (was: access layer → chat+config UI →
6+). Artifact preview hardens the surface humans actually land on; chat builds on
it; identity follows with a known swap point; sandbox hosts stay last.

Open proofs that sit on top of done phases (the only in-progress work):
[docs/tasks/in-progress/open-proofs.md](docs/tasks/in-progress/open-proofs.md).
**Next product phase is 5** (chat). Phase 7 listing shipped with the board SPA;
the profile editor is still later. Phase 5B may run alongside the later Phase 5A
workstreams only after exact-profile, task-stream, and message-command contracts are
frozen; direct chat remains independently releasable.

## Working rules

- Profiles and skills first (`agents/`, `platform-skills/`). New use cases are
  content, not core-loop special cases.
- Control plane owns scheduling; workers own execution; the Pi runner owns model
  turns and is never exposed on the network.
- No raw provider credentials in prompts, workspaces, events, or artifacts.
- Parameterized SQL only, in `packages/persistence`.
- Do not commit `.env` or sibling keys. E2e may source `../dns-remote-agent/.env`
  for `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` only, then clamp snapshot store,
  catalog, and runtime to this repo’s defaults.
- Cloud sandbox providers: document against `SandboxProvider`; do not implement
  in this repo until Phase 8+.

## Updating progress

When a phase exits:

1. Move or tick the checklist under `docs/tasks/done/` (or `in-progress/` / `later/`).
2. Update **this table**.
3. Update [docs/tasks/README.md](docs/tasks/README.md) “Current” line.
4. Write or append `docs/session-handoff/YYYY-MM-DD-*.md` (keep `2026-08-29-current.md` as the rolling status, or replace it).
5. If the shipped loop or env surface changed, update [AGENTS.md](AGENTS.md).

Regression gate: `bash scripts/live-board-e2e.sh` (Postgres + Docker + one provider key).
