# @remote-sandbox-agents/contracts

The dependency root. Contains all interface definitions and data types, grouped by domain.

- **Zero runtime code** — only type definitions matter
- **No dependencies** — this package imports from nothing
- **Every other package** imports from here for type definitions

## Folder structure

Each folder is one domain concern — open a folder to understand that part of the system:

- `common/` — shared primitives (TaskSource, RunStatus, RunRecord)
- `gateway/` — inbound task submission interface
- `providers/` — outbound adapters (board, repo, channel, messaging)
- `orchestrator/` — profile selection, prompt assembly, routing
- `worker/` — envelope, runtime, engine, workspace, approval
- `tools/` — pluggable tool registry (routed to orchestrator or worker by config)
- `skills/` — pluggable skill loader (subscribable by profile)
- `memory/` — pluggable memory store (read by orchestrator, proposals from worker)
- `adapters/` — channel adapter interface (Linear, Slack, CLI)
- `secrets/` — secret resolution interface
