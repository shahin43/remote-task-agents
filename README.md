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

## Run locally

The Node process does **not** load `.env` by itself. Put the provider key in
`.env` (gitignored), then either source it before starting the API, or use
`scripts/live-board-e2e.sh`, which sources `.env` for you.

### First-time setup

```bash
cp .env.example .env          # set OPENAI_API_KEY or ANTHROPIC_API_KEY
docker compose up postgres -d # host port 5433, user/db remote_agent
npm install
npm run build
npm run build:web
npm run build:pi-agent-image  # once; guest image remote-sandbox-agents/pi-agent:local
bash scripts/init-sample-fixture.sh
```

Postgres can stay up between runs (`docker compose up postgres -d`). Rebuild the
guest image only when the Pi runner or Dockerfile changes.

### Interactive board (API + worker on the host)

```bash
set -a && source .env && set +a
export DATABASE_URL="${DATABASE_URL:-postgres://remote_agent@127.0.0.1:5433/remote_agent}"
export REMOTE_AGENT_BOARD_PROJECT_ID="${REMOTE_AGENT_BOARD_PROJECT_ID:-sample/service}"
node packages/scheduler/dist/index.js --role api --with-worker
```

Board: `http://127.0.0.1:8787/app/`

Agents run in Docker (`sandbox-docker`). Create a task on the board assigned to
`agent-coder` or `agent-author`; the host worker picks it up.

### Unattended two-task e2e

Requires Postgres, Docker, and a provider key in `.env`. Seeds the sample repo,
builds, starts `api --with-worker`, then:

1. Coder → reviewer on `sample/service` (git-artifact promotion)
2. Author zero-repo paper with a declared artifact preview

```bash
bash scripts/live-board-e2e.sh
```

The script stops the API when it exits. A PASS line looks like
`PASS: e2e legs=all`. Logs land in `runs/e2e-logs/`.

## Key docs

| File | Role |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | How we work, spec progress, how processes vs sandboxes run |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mental model and extension seams |
| [AGENTS.md](AGENTS.md) | Commands, conventions, environment, e2e definition of working |
| [docs/README.md](docs/README.md) | Specs, task tracker, research papers, and how agents pick work |

## License

Apache-2.0 — see [LICENSE](LICENSE).
