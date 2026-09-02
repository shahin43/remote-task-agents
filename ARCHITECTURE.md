# Remote Sandbox Agents — Architecture

This is the generic architecture, extracted from `dns-remote-agent`. It keeps the
session-first core, the board, the worker scheduler, and the sandbox compute plane —
restricted to the **unix-local** and **Docker** backends. Cloud execution (Lambda
MicroVM), cloud snapshot stores (S3), and org-specific capabilities (Redshift, host git
promotion) are seams you *can* add later, not parts of this repo.

## 1. Mental model

```
┌─────────────────────────  one board task  ────────────────────────────┐
│                                                                       │
│   create_task ── assign ── routing                                    │
│       │                                                               │
│       ├──▶  one worker session (actor=worker)                         │
│       │      ├ one sandbox session per attempt                        │
│       │      ├ one agent-engine run (Pi runner) per turn              │
│       │      ├ one snapshot per attempt (local disk)                  │
│       │      └ one agent_runs ledger row per attempt                  │
│       │                                                               │
│       ├──▶  status → working → review                                 │
│       │                                                               │
│       └──▶  follow_up reopens the worker session, increments          │
│             attemptNumber, optionally hydrates the workspace snapshot │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

Four invariants:

1. **Session-first.** Every worker attempt, sandbox lifecycle event, and engine event
   flows through `sessions` (typed actor/status) and `session_events` (append-only
   audit log) in Postgres. Routing is board-driven (`assigneeId` → worker profile),
   never LLM-driven.
2. **Two planes.** The *control plane* (board API, control routing, persistence)
   decides what runs. The *execution plane* (worker, agent engine inside a sandbox)
   does the work. They communicate through the bus and durable session state, never
   shared in-process state.
3. **The harness owns side effects.** The model never sees raw provider tokens.
   External writes (board comments, handoff reassignment, MR draft capture) happen
   through harness-mediated appliers that read sidecar files after the run.
4. **`agent_runs` is the operational projection.** One indexed row per attempt:
   status, backend, sandbox session id, timings, snapshot ref, summary, token usage.

## 2. Process roles

One binary (`packages/scheduler`), four roles. Same shape as production, runnable on a
laptop:

| Role | Owns | Notes |
|---|---|---|
| `--role api` | HTTP: SPA at `/app/`, JSON board API at `/api/*` | HTTP-only by default; never routes or executes |
| `--role control` | Board poll loop → routing decisions | idempotent under concurrent replicas |
| `--role worker` | Claims `routing` sessions atomically, runs the agent in a sandbox, snapshots, finalizes the ledger | scale-out; graceful SIGTERM |
| `--role api --with-worker` | All-in-one for local dev | drain logs namespaced `api.dev_worker_*` |

## 3. Sandbox compute plane

A standalone library (`packages/sandbox`, zero service deps): `Manifest` + mounts +
capabilities + completion snapshots + providers.

| Backend | Isolation | Use |
|---|---|---|
| `sandbox-unix-local` | none (temp dir on host) | tests, trusted local dev |
| `sandbox-docker` | container; agent engine runs **inside** via `docker exec -i` | default |

Workspace layout inside every sandbox (the *task bundle contract*):

```
/workspace
  AGENTS.md          platform + profile instructions
  context/           session context, task brief (provenance-labelled)
  repo/              the mounted git working tree
  skills/            INDEX.md + <skillId>/… (resolved, pinned at route time)
  task/scope.json    capabilities, target paths, pinned skills, limits
  artifacts/         agent outputs (documents, reports, deliverables)
  .agent/            runtime: runner bundle, spec.json, events, handoff sidecars
```

Snapshots are tars of the workspace persisted by `LocalSnapshotStore` to a runs
directory on disk. Follow-ups hydrate the prior snapshot back into a fresh sandbox.

## 4. Agent engine

`pi-agent` is the shipped engine: a bundled runner (`pi-runner.bundle.cjs`) copied into
the sandbox and executed there. Tools are local to the container and scope-clamped:
`read_file`, `write_file`, `shell`, `apply_patch`, plus capability-gated tools:

- `handoff` — writes `.agent/handoff.json`; the harness applier reassigns the board
  task and posts a comment after the run. Coder→reviewer, reviewer→human, author→human.
- `read_skill` — returns a pinned skill's `SKILL.md` body on demand (index in prompt,
  body on request, so first-turn tokens stay flat).

Engine selection is a registry keyed by `profile.engine.kind`, so a second engine
(e.g. Codex App Server) is an adapter + a registry entry, not a core change.

## 5. Skills — the generic extension layer

Skills are versioned instruction/script folders, **not** code changes:

```
platform-skills/<folder>/
  SKILL.md               required; YAML frontmatter { name, description, [risk_class], [tags] }
  skill.manifest.json    optional; { name, version, engines[], toolDeps[], entry }
  references/ scripts/   optional payload
```

- Resolution runs at **route time**: `profile.skills` (all | tagged | named) →
  `resolveSkills()` → pinned onto the session's effective scope → materialized under
  `skills/<id>/` → recorded on `agent_runs`.
- `riskClass` (`readonly` | `shell` | `network`) is clamped against the profile's
  granted capabilities. A skill that needs more than the run grants is dropped at
  resolution with a task comment — never silently downgraded.
- Skills never carry secrets. They declare needs; the harness brokers them.

Shipped catalog: `repo-orientation` (coding), `business-paper` (structured document
writing), `chart` (data visualisation for documents).

**This is the hook for new use cases.** "Research X and write a paper" is a profile +
skills, not a platform change. Org-specific data access (the way `dns-remote-agent`
does Redshift) re-enters later as a *named capability* fulfilled per backend — the
skill declares it, the profile grants it, the harness provides it.

## 6. Agent profiles

Profiles live at `agents/<id>/` (`profile.yaml`, `SOUL.md`, `base-prompt.md`,
optionally `AGENTS.md` and profile-local `skills/`).

| Profile | Engine | Skills | Capabilities | Hands off to |
|---|---|---|---|---|
| `coder` | pi-agent | repo-orientation | filesystem, shell, apply_patch, handoff, request_mr | `agent-reviewer` |
| `reviewer` | pi-agent | repo-orientation | filesystem, shell, apply_patch, handoff | human (task creator) |
| `author` | pi-agent | business-paper, chart | filesystem, shell, handoff | human (task creator) |

The **MR draft flow**: coder finishes → writes `.agent/mr-request.json` (title,
description, branch) → harness captures it onto the task (`mrRequest:
pending_approval`) → reviewer verdicts → a human approves. In this generic repo the
promotion target is a plain `git bundle` / patch artifact on the snapshot — wiring an
actual host git/GitHub MR is an org-specific applier behind the same intent contract.

A structural **autobounce** safety net reassigns to a configured human if a succeeded
run never called `handoff`, so a task can never silently stall.

## 7. Persistence

Single Postgres schema: `sessions`, `session_events` (+ atomic per-session counter),
`board_tasks`, `task_assignments`, `task_events`, `users`, `agents`, `agent_runs`,
`work_queue`, `schema_versions`. Three-table division of responsibility:

- `task_events` — user-facing board feed.
- `session_events` — append-only audit + LLM replay.
- `agent_runs` — one indexed row per attempt for operational queries.

All access through `packages/persistence` repos with parameterized queries. In-memory
implementations of every repo exist for tests.

## 8. Extension seams

Every arrow that crosses a plane boundary is a typed interface. Add behavior by
implementing a seam and registering it in the composition root — never by editing the
core loop.

| Seam | Abstracts | Ships with | Extend by |
|---|---|---|---|
| `Channel` | inbound task intake + outbound status | `BoardChannel` | implement + register (Slack, WhatsApp, webhook…) |
| `AgentEngine` | one LLM turn | Pi runner in-container | adapter + registry entry |
| `SandboxProvider` | the compute boundary | unix-local, docker | new provider (this is where MicroVM/Firecracker goes) |
| `MountStrategy` | how content enters the sandbox | local-dir, inline-file, git | add mount type |
| `Capability` | what the agent may do | filesystem, shell, handoff, skills, request_mr | add capability + tool + scope entry |
| `SnapshotStore` | durable run output | local disk | S3/GCS store |
| `SkillSource` | where skills come from | `platform-skills/` in-repo | workspace or registry source |
| repos + `AgentBus` | durable state + pub/sub | Postgres, in-memory | alternative store |

A **channel** like WhatsApp ("message me the finished paper") is an outbound notifier
against the `Channel` seam — explicitly out of scope for the first port, listed so
nobody wedges it into the worker.

## 9. Security model

1. One task per worker, one workspace per run.
2. The model never sees raw provider tokens at rest in the workspace; engine creds
   travel on an env allowlist to the runner process only.
3. Approval policy: auto-approve narrow workspace-local actions, auto-decline the rest.
4. All external content (task text, comments, repo content) is untrusted.
5. The harness owns external side effects; the model edits the workspace only.
6. Scope clamp: `profile.scopePolicy` bounds repos, mount types, path denylist, and
   egress before the sandbox exists.
