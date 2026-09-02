# Remote Sandbox Agents

A **generic** remote coding/authoring agent service: a board task → an isolated worker
agent running inside a sandbox (unix-local or Docker) → a workspace snapshot with a real
git diff → a structured summary and handoff back on the board.

This repo is the generic extraction of an internal service. Organisation-specific
execution backends, cloud snapshot stores, warehouse access, and host-git promotion
are out of scope. Run end-to-end with only:

- Node 22+
- Postgres (via Docker Compose)
- Docker (for `sandbox-docker`; `sandbox-unix-local` needs nothing extra)
- One LLM provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)

**No cloud credentials. No org-specific services.**

## What ships

| Layer | Contents |
|---|---|
| Platform | Board API + UI (6-column board, artifact document reader, Agents listing), control routing, worker scheduler, sandbox plane (unix-local + Docker), local-disk snapshots, handoff loop, git-artifact promotion (`changes.patch` + `branch.bundle`) |
| Agent profiles | `coder` (implements, requests MR draft), `reviewer` (verdicts), `author` (research + write a business document; no repo mount) |
| Platform skills | `repo-orientation`, `business-paper`, `chart` |
| Sample repo | `fixtures/sample-service/` (initialized into `runs/seed/sample-service`) |

## Quick start

```bash
cp .env.example .env   # set OPENAI_API_KEY or ANTHROPIC_API_KEY
docker compose up postgres -d
bash scripts/init-sample-fixture.sh
npm install
npm run build
npm run build:web
npm run build:pi-agent-image   # once; guest image remote-sandbox-agents/pi-agent:local
DATABASE_URL='postgres://remote_agent@127.0.0.1:5433/remote_agent' \
REMOTE_AGENT_BOARD_PROJECT_ID='sample/service' \
node packages/scheduler/dist/index.js --role api --with-worker
```

Board: `http://127.0.0.1:8787/app/`

Unattended regression: `bash scripts/live-board-e2e.sh` (Postgres + Docker + a provider key).

## Where to start

1. [`docs/service-state-and-roadmap.html`](docs/service-state-and-roadmap.html) — visual service state, hardening map, usage/cost truth, and roadmap.
2. [`docs/market-research-and-gtm-2026.html`](docs/market-research-and-gtm-2026.html) — competitive research, positioning options, recommended wedge, and go-to-market strategy.
3. [`docs/brand-naming-strategy-2026.html`](docs/brand-naming-strategy-2026.html) — researched open-source launch name, alternatives, collision screen, and brand architecture.
4. [`docs/hermes-agent-implementation-review-2026.html`](docs/hermes-agent-implementation-review-2026.html) — source-grounded review of Hermes profiles, memory hydration, learning, delegation, Kanban handoff, hosted rooms, and sessions.
5. `DEVELOPMENT.md` — guidelines, spec progress, how processes vs sandboxes run.
6. `ARCHITECTURE.md` — mental model and extension seams.
7. `AGENTS.md` — commands, conventions, environment, e2e definition of working.
8. `docs/tasks/README.md` — done / in-progress / later checklists.
9. `docs/specs/2026-08-29-generic-open-source-service-spec.md` — product spec.
10. [`docs/specs/2026-08-29-chat-orchestration.md`](docs/specs/2026-08-29-chat-orchestration.md) — Phase 5A chat, durable SSE, and direct conversation spec.
11. [`docs/specs/2026-08-31-durable-agent-coordination-and-handoffs.md`](docs/specs/2026-08-31-durable-agent-coordination-and-handoffs.md) — Phase 5B durable profiles, sessions, delegation, child return, and typed handoff spec.
12. `docs/specs/2026-08-29-port-from-dns-remote-agent.md` — Phase 0 porting spec.

## License

Apache-2.0 — see [LICENSE](LICENSE).
