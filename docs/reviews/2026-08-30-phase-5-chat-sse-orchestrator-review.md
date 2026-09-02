# Architecture review — Phase 5 chat, SSE, and project orchestrator

Date: 2026-08-30  
Status: review complete; feeds the Phase 5 PRD/spec  
Scope: current generic service, end-to-end path, and readiness for chat, live
events, and a project/tenant-scoped orchestrator agent  
Companion:
[Phase 5 PRD and technical delivery spec](../specs/2026-08-29-chat-orchestration.md)

## 1. Executive verdict

The repository has a strong base for Phase 5: durable sessions, ordered session
events, atomic worker claims, attempt-level run records, snapshot continuation,
profile/skill seams, and a control/worker split. Chat should build on those
primitives rather than introduce a second conversation system.

The current 2026-08-29 Phase 5 draft is directionally correct but is not yet an
implementation work order. It understates six architectural problems:

1. The existing `orchestrator` actor is a dormant type, not a runnable service.
   Routing can create an open orchestrator session, but no shipped role claims or
   executes it.
2. The Pi worker process buffers model output and tool events until the sandbox
   process exits. An SSE route alone would stream lifecycle records, not a live
   answer.
3. Events are ordered per session, while a task can cross sessions after a
   handoff. There is no durable task-level cursor for reconnect and catch-up.
4. Follow-up submission is check-then-update and has no idempotency key. Two
   concurrent messages can race and open the same next attempt.
5. Board assignment and conversational reply target are currently conflated. A
   task commonly hands back to a human, after which the UI no longer has an agent
   assignee even though the prior agent conversation is continuable.
6. The current native `EventSource` placeholder cannot attach the bearer header
   used by this application's local authentication posture.

The recommended Phase 5 is therefore an ordered delivery program, not one UI
feature: first close the event and continuation correctness gaps; then ship task
chat and chat intake; finally add an opt-in orchestrator runtime with constrained
tools, leases, budgets, and child-session accounting.

## 2. What the service does today

The current product is a board-driven remote-agent service:

```text
board task + assignment
  -> control resolves a registered agent to a profile
  -> one worker session enters routing
  -> worker claims it with a lease
  -> a fresh Docker or unix-local sandbox is materialized
  -> Pi runs inside the sandbox against the task bundle
  -> harness captures tool events, snapshot, artifacts, MR intent, and handoff
  -> control projects completion and the next assignment onto the board
```

The durable record is deliberately split:

- `board_tasks` and `task_events` are the human-facing work queue and audit
  trail.
- `sessions` and `session_events` are the conversation and execution event log.
- `agent_runs` is the operational projection for each sandbox attempt.
- snapshots are the workspace checkpoint and artifact source.

This division is sound. Chat should be a task/session read and write projection;
it must not become a new `chats`/`messages` source of truth.

## 3. Evidence reviewed

### 3.1 Canonical documents

- `ARCHITECTURE.md`
- `DEVELOPMENT.md`
- `docs/specs/2026-08-29-generic-open-source-service-spec.md`
- `docs/specs/2026-08-29-port-from-dns-remote-agent.md`
- `docs/specs/2026-08-29-task-artifact-preview.md`
- the former short `docs/specs/2026-08-29-chat-orchestration.md`
- `docs/tasks/` and the 2026-08-29 session handoff

The sibling enterprise repository was used only as historical input. Its older
orchestrator was removed in 2026 because the direct board-to-worker path was
simpler. The reusable lesson is the scope-clamped parent/child session model; the
generic project must not blindly restore the old autonomous router.

### 3.2 Code paths traced

- Board intake and HTTP projection:
  `packages/scheduler/src/api/board-api.ts:564`
- Control-only assignment routing:
  `packages/orchestrator/src/board/assignment-router.ts:82`
- Worker claim, execution, event capture, snapshot, and completion:
  `packages/scheduler/src/wiring/worker-scheduler.ts:172`
- Continuation and workspace resume:
  `packages/scheduler/src/wiring/session-continuation.ts:52`
- Ordered persistence and Postgres notification:
  `packages/persistence/src/session-events-repo.ts:11` and
  `packages/persistence/src/agent-bus.ts:35`
- In-sandbox Pi protocol and host adapter:
  `packages/agent-engines/src/pi/pi-runner-entry.ts:21` and
  `packages/scheduler/src/wiring/pi-runner-engine-adapter.ts:37`
- Board polling and drawer polling:
  `packages/web/src/pages/board-page.tsx:19` and
  `packages/web/src/components/task-drawer.tsx:53`
- Dormant orchestrator profile and routing branch:
  `packages/orchestrator/assets/agents/orchestrator-supervisor/profile.yaml:1`,
  `packages/scheduler/src/wiring/resolve-target.ts:23`

### 3.3 Verification in this review

- `npm run check`: passed.
- Package tests before the persistence suite: 174 passed; Docker and
  database-gated tests skipped when their dependencies were unavailable.
- `test:persistence`: 43 passed, 4 skipped, 1 failed. The failure is a stale
  migration test fixture that lists migrations through `0010` while `0011` is
  now present.
- Remaining agent-engine and channel tests: 59 passed.
- `test:scheduler`: 288 passed, 3 skipped, 1 failed because the managed sandbox
  forbids binding `127.0.0.1`; this is environmental, not an observed health
  implementation regression.
- A fresh Docker/live-provider e2e was not run in this review. The repository's
  recorded 2026-08-29 live evidence covers host `api --with-worker` plus Docker
  sandboxes, not Phase 5 and not the full split topology.

## 4. Architectural strengths to preserve

### 4.1 Session-first continuity

The continuation service reuses the same worker session, increments the attempt,
appends a new `channel.input`, and optionally stamps the last snapshot for restore.
The engine rebuilds conversation context from ordered `session_events`. This is
the correct base for multi-turn task chat.

### 4.2 Fresh-envelope precedence

A restored checkpoint is work product, not authority. The new run's profile,
capabilities, skills, credentials, and scope must be resolved server-side and
overlaid after restore. Phase 5 must preserve this rule on every chat turn and
orchestrator dispatch.

### 4.3 Plane separation

The API can remain HTTP-only, control can remain the routing authority, and the
worker can remain the only service with sandbox authority. Phase 5 must not add
Docker access, model credentials, or worker execution to the API process.

### 4.4 Profiles and skills as extension points

Chat eligibility and orchestrator policy belong in versioned profile/project
configuration. A new use case should remain profile + skills unless it needs a
generic platform seam.

### 4.5 Harness-owned side effects

Handoff, artifacts, comments, and promotion are applied outside the model. A
generic orchestrator must follow the same pattern: its tool calls are untrusted
requests evaluated by control-plane policy, not direct database or sandbox
authority.

## 5. Findings and required design changes

### P0 — Orchestrator assignments currently dead-end

`BoardAssignmentRouter` can create an `actor='orchestrator'`, `status='open'`
session, and the profile loader understands orchestrator profiles. The worker
claim query, however, claims only `actor='worker' AND status='routing'`; there is
no orchestrator runner, claim loop, dispatch tool implementation, or lifecycle
ledger in the shipped roles.

Required change: add an explicit, least-privilege orchestrator runtime and role.
Do not execute the orchestrator in the API process and do not give it worker or
sandbox credentials.

### P0 — The proposed synchronous chat response violates the split topology

The former draft returned `{ chatId, sessionId }` from `POST /api/chats`. In the
production-shaped topology the API writes the task; control creates the session
later. The API cannot promise a session id without reclaiming routing authority.

Required change: return `202 Accepted` with the task/chat id and stream URLs.
Control remains the sole creator of routed sessions.

### P0 — There is no reconnectable task event stream

`session_events.event_index` is monotonic only within a session. Agent-to-agent
handoff creates another session for the same task. Native SSE reconnection has one
`Last-Event-ID`, so a compound per-session cursor would be fragile and hard to
operate.

Required change: add a durable task-stream projection with one monotonic sequence
per task. It references board/session source records and feeds both JSON catch-up
and SSE. It is a delivery/read model; board/session/run tables remain authoritative.

### P0 — Live assistant output is not currently live

The in-container runner collects tool events in memory and writes them to
`.agent/events.jsonl` at the end. `PiRunnerEngineAdapter` uses buffered `exec()`,
then publishes tool calls and the final assistant message after collection.

Required change: use the existing `SandboxSession.spawnStream` seam to run a
versioned JSONL protocol. Publish coalesced assistant deltas and tool lifecycle
events while the process runs, then persist one canonical final
`assistant_message` for replay. Providers without streaming support degrade to
lifecycle plus final output; they must not break the task stream contract.

### P0 — Message submission is neither atomic nor idempotent

The continuation path reads the session, checks status, updates status/metadata,
then appends events through separate calls. Concurrent requests can observe the
same terminal state. Network retries can append the same user message twice.

Required change: API acceptance must transactionally persist a generic idempotent
task command/receipt and safe optimistic timeline item. Control then claims and
transactionally applies the command (reopen, increment attempt, stamp resume ref,
append canonical input). This prevents duplicate attempts without making the
HTTP-only API a scheduler. Require a client message id or idempotency key.

### P0 — Orchestrator authority needs a hard ceiling

The historical upstream orchestrator could name profiles and dispatch work. That
is too broad for a public, multi-project design unless the server clamps every
request.

Required change: bind each orchestrator to one immutable tenant/project envelope;
allow only project-registered worker agents; enforce maximum depth, child count,
parallelism, runtime, tool calls, and token/cost budget; and apply
`requested scope ∩ orchestrator policy ∩ worker profile policy ∩ project policy`.

### P1 — Agent assignment is not the same as reply target

Handoff commonly reassigns a completed task to a human. The current drawer only
shows “Send to agent” when the current assignee is an agent, even though the
latest worker session remains continuable.

Required change: record a server-managed `conversationAgentId`/reply target on
the task projection, distinct from work-queue ownership. Explicit recipient
changes must be validated against registered chat-eligible agents.

### P1 — Profile versioning is stored but not pinned into the run

The database stores versioned profile rows, but routing resolves the latest
profile and stores no `profileVersion` in session metadata. Worker claim resolves
the profile again. A profile can therefore change between route and execution.

Required change: Phase 5 must pin the exact profile document/version at route
time for workers and orchestrators. A fresh immutable run envelope wins over
workspace files and later profile updates.

### P1 — `kind: chat` needs a first-class queryable field

The former draft proposed a chat task kind without a contract/schema field.
Storing it only in JSON metadata would make filtering and indexing a long-term
JSONB convention.

Required change: add a small `task_kind` field (`work | chat`) to the board
contract and table. It changes presentation/intake behavior only; it does not
create separate chat persistence.

### P1 — Native EventSource cannot use the current bearer header

The web client sends authorization headers through `fetch`. Browser
`EventSource` cannot set those headers, and putting tokens in the URL would leak
them into logs and history.

Required change: use a fetch-based SSE client in Phase 5. Phase 6 can later use a
same-origin secure cookie without changing the stream protocol.

### P1 — Raw session events are not a safe chat API

Tool call payloads can contain shell output, file content, paths, model/provider
fields, and error detail. Returning raw payloads to every chat viewer creates a
future authorization and secret-redaction trap.

Required change: add a typed, allowlisted `TaskTimelineProjector`. Viewer events
contain bounded text, tool name/status/timing, run state, handoff, and artifact
references. Raw session event access remains an operator/debug surface and will
be role-gated in Phase 6.

### P1 — SSE must be an invalidation and delivery layer, not a new truth

Postgres notifications can be dropped and connections will restart. The current
bus also has a replay/subscribe race if a notification arrives between replay and
handler registration.

Required change: notifications carry only `{taskId, nextIndex}`. Every client
reads missing durable rows after its last cursor. Reconnect correctness must not
depend on delivery of every `NOTIFY`.

### P1 — Test baseline contains one real stale fixture

`packages/persistence/src/migrate.test.ts` expects migrations through `0010`, but
`0011_agent_runs_artifacts.sql` exists. This is unrelated to Phase 5 behavior but
must be fixed before establishing a green Phase 5 baseline.

## 6. Recommended target shape

```text
Browser
  REST writes + JSON catch-up + fetch-SSE
       |
       v
API role ----------------------------------------------+
  task/chat commands                                   |
  task timeline projection                             |
  SSE fanout (read-only)                               |
       |                                               |
       v                                               |
Postgres                                               |
  board/tasks  sessions/events  agent_runs             |
  task_commands  orchestration_turns                   |
  task_stream_events + NOTIFY                          |
       ^                         ^                     |
       |                         |                     |
Control role                    Worker role             |
  deterministic assignment     sandbox claim/run       |
  profile/version/scope pin     live runner protocol ---+
       |
       v
Orchestrator role (control-plane execution, no sandbox authority)
  claims orchestrator turns
  provider call with control tools only
  dispatch request -> policy clamp -> child worker session
```

The separate orchestrator role is intentional. It is part of the control plane,
but isolates model execution and provider credentials from the deterministic
control loop. It has no filesystem, shell, Docker socket, repository credential,
promotion credential, or general outbound tool.

## 7. Delivery recommendation

Ship Phase 5 behind ordered gates:

1. **P5-A — correctness baseline:** fix the migration test, pin profiles, add
   atomic/idempotent message acceptance.
2. **P5-B — durable timeline and SSE:** task sequence, JSON catch-up, SSE,
   redacted projection, fetch client, reconnect/backpressure tests.
3. **P5-C — task chat:** transcript UI, attempt boundaries, workspace resume,
   artifact links, reply-target semantics.
4. **P5-D — chat intake:** registered-agent resolution, project default,
   `task_kind=chat`, zero-repo default, API and Chats UI.
5. **P5-E — orchestrator:** separate runtime, turn ledger, scoped tools,
   parent/child sessions, budgets, failure recovery, opt-in project config.
6. **P5-F — release gate:** split-process Postgres test, Docker live test,
   reconnect/restart/concurrency/security-negative evidence.

Do not make the orchestrator the universal path. Direct worker assignment remains
the cheapest and most predictable route. A project opts into an orchestrator by
registering it as an agent and selecting it as the chat/default assignee.

## 8. Production-readiness boundary

Phase 5 may be released for trusted local/self-host use after its complete gate.
It must not be represented as ready for untrusted shared or multi-tenant use until
Phase 6 removes client-supplied identity and enforces authorization, tenant/project
membership, CORS, CSRF, and viewer/operator/admin data boundaries.

Even in trusted mode, Phase 5 must ship with:

- no credentials in event payloads, prompts, workspaces, or SSE URLs;
- bounded message/event sizes and connection counts;
- durable cursor catch-up across API/worker/control restarts;
- orchestrator scope and budget clamps;
- negative tests for cross-project agent selection, raw event leakage, duplicate
  submission, dispatch loops, and stale leases.

## 9. Decisions carried into the companion spec

1. SSE, not WebSocket; writes remain REST.
2. Fetch-based SSE client; never bearer tokens in query strings.
3. `task_kind` is a first-class board field; chat remains a task lens.
4. External chat creation selects a registered `agentId`, not an arbitrary
   `profileId`.
5. `POST /api/chats` returns `202` without requiring a session id.
6. Attempt-per-message remains the v1 continuity model; warm sandboxes are later.
7. Direct worker chat and orchestrated chat are both supported. Orchestration is
   opt-in, bounded, and never required for ordinary tasks.
8. The orchestrator runs as a separate least-privilege role and can request child
   dispatch only through harness-clamped tools.
9. Phase 5 introduces a durable task-stream projection and an orchestrator-turn
   projection; neither replaces the canonical board/session/run records.
