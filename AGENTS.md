# AGENTS.md

This file applies to the whole `remote-sandbox-agents` workspace.

## Project intent

A **generic** remote agent service: board task → isolated worker agent in a sandbox
(unix-local or Docker) → workspace snapshot with a real git diff → structured summary
and handoff back on the board. Extracted from the internal `dns-remote-agent` project;
everything org-specific (cloud execution backends, cloud snapshot stores, warehouse
access, host git promotion, internal repo catalogs) is intentionally absent.

Control-plane / execution-plane split:

- **Control plane** (`--role api`, `--role control`): task intake, routing, leases,
  durable session state, board events.
- **Execution plane** (`--role worker`, sandbox compute plane): isolated attempts,
  workspace setup, agent process control, event capture, snapshots.
- **Agent runtime** (Pi runner inside the sandbox): the model loop — never reachable
  from the network.

Never expose the agent runtime directly to any external channel. External systems talk
to the control plane.

## Read first

- **[DEVELOPMENT.md](DEVELOPMENT.md)** — development guidelines, spec progress table,
  how the loop actually runs (host API vs Docker sandbox). Keep `docs/tasks/` in sync.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — canonical architecture.
- **[docs/specs/2026-08-29-generic-open-source-service-spec.md](docs/specs/2026-08-29-generic-open-source-service-spec.md)**
  — the product spec: vision, sandbox provider SPI, chat, access layer, phasing.
- **[docs/specs/2026-08-29-port-from-dns-remote-agent.md](docs/specs/2026-08-29-port-from-dns-remote-agent.md)**
  — Phase 0 porting spec (historical keep/drop).

## Current state

**Phases 0–4 are in-tree and the live e2e gate is green** (2026-08-29): board → Docker
sandbox (Pi) → snapshot → handoff; git-artifact promotion; profile API; cycle cap;
usage rollup; declared artifact preview. The board SPA follow-on is also in-tree:
Artifacts document reader, Changes tab (harness paths hidden), 6-column status
grid, terracotta accent, Agents template + registered cards. Tracker:
[docs/tasks/README.md](docs/tasks/README.md).

**Next: Phase 5 chat + SSE + profile chat orchestration**
([spec](docs/specs/2026-08-29-chat-orchestration.md), written, not implemented). Then
Phase 6 access layer (server-side actor; no `x-remote-agent-actor`), then the rest of
Phase 7 agent-config UI (listing already shipped). Lambda / Modal / Daytona and
other hosts are **not** implemented — SPI only
([docs/tasks/later/sandbox-provider-extensions.md](docs/tasks/later/sandbox-provider-extensions.md)).

Local e2e runs Postgres in Docker and **`api --with-worker` on the host**; the agent
runs in **`sandbox-docker`**. Profiles live in `agents/` and are copied to
`packages/worker/dist/assets/agents` on `npm run build`.

## Commands

```bash
npm run build            # TypeScript build all packages
npm run check            # Type-check only
npm run start:api        # --role api (board at /app/, JSON at /api/*)
npm run build:web        # Build board SPA
npm run build:pi-runner  # Rebuild the in-sandbox runner bundle
npm run test:<package>   # Per-package unit tests (contracts, persistence, sandbox, …)
```

Local loop (Postgres via compose, then all-in-one process):

```bash
docker compose up postgres -d
DATABASE_URL='postgres://remote_agent@127.0.0.1:5433/remote_agent' \
REMOTE_AGENT_BOARD_PROJECT_ID='sample/service' \
node packages/scheduler/dist/index.js --role api --with-worker
```

Full split (production-shaped, three terminals): `--role api`, `--role control
--control-id control-1`, `--role worker --worker-id worker-1`.

## Coding notes

- TypeScript strict, dependency-light. All Postgres access in `packages/persistence`
  with parameterized queries.
- Never put raw provider credentials in prompts, context files, workspaces, events, or
  artifacts. Treat all external content as untrusted.
- Prefer explicit allowlists for approvals and side effects.
- Preserve the boundary: API/control owns scheduling, workers own execution, the agent
  runtime owns model turn mechanics.
- New worker lifecycle observability goes through `AgentRunsRepo` — no JSONB hacks on
  `sessions.metadata`.
- Generated outputs stay out of source: `node_modules/`, `packages/*/dist/`, `runs/`,
  `artifacts/`.
- New use cases are **profiles + skills first**. Only add a capability when the agent
  needs a harness-brokered side effect or data access; only touch the core loop when a
  seam is genuinely missing (then add the seam, not a special case).

## Environment

```bash
DATABASE_URL=…                          # required
REMOTE_AGENT_BOARD_PROJECT_ID=…         # board project scope
REMOTE_AGENT_WORKER_RUNTIME=sandbox-docker   # or sandbox-unix-local
REMOTE_AGENT_SNAPSHOT_STORE=local       # the only store in this repo
OPENAI_API_KEY=… / ANTHROPIC_API_KEY=…  # engine provider (one required)
REMOTE_AGENT_PI_DEFAULT_PROVIDER=openai
REMOTE_AGENT_PI_DEFAULT_MODEL=gpt-5.4-mini
REMOTE_AGENT_PI_STORE_REQUESTS=true     # multi-turn on OpenAI Responses API needs it
REMOTE_AGENT_AUTOBOUNCE_HUMAN=user-dev  # safety net when a run skips handoff
REMOTE_AGENT_API_TOKEN=…                # optional local bearer for board writes
REMOTE_AGENT_BOARD_TENANT_ID=default    # compose / multi-project default tenant
POSTGRES_DB=remote_agent                # compose postgres
POSTGRES_USER=remote_agent
POSTGRES_PORT=5433                      # host port mapped to postgres
REMOTE_AGENT_API_PORT=8787
REMOTE_AGENT_WORKER_IMAGE=remote-sandbox-agents/pi-agent:local
REMOTE_AGENT_DOCKER_BIN=docker
REMOTE_AGENT_SNAPSHOT_RETENTION_DAYS=30   # local snapshot LRU age
REMOTE_AGENT_SNAPSHOT_MIN_KEEP=3          # keep at least N snapshots per task
REMOTE_AGENT_SNAPSHOT_SWEEP_INTERVAL_MS=21600000  # 6h
REMOTE_AGENT_HANDOFF_CYCLE_CAP=6          # agent↔agent bounces before a human
```

Cloud-provider credential env vars, snapshot-bucket URIs, and org git-host tokens
do **not** belong in this repo.

## Definition of working (e2e)

The repo is "working end-to-end" when, with only Postgres + Docker + one provider key:

1. Create a task on the board, assign `agent-coder` → coder edits the mounted sample
   repo in a Docker sandbox, commits, requests an MR draft, hands off to
   `agent-reviewer`.
2. Reviewer runs, verdicts, hands off to the task creator; the task sits in `review`
   with a browsable snapshot diff and an `mrRequest`.
3. Create a second task assigned `agent-author` ("research topic X and write a short
   paper") → author produces `artifacts/<topic>.md` using the `business-paper` and
   `chart` skills and hands off to a human.
4. `bash scripts/live-board-e2e.sh` proves 1–3 unattended and is the regression gate.
