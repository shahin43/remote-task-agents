# Phase 5 PRD and delivery spec — chat, SSE, and project orchestrator

Date: 2026-08-29; expanded after architecture review 2026-08-30  
Status: **draft for review — not yet an implementation work order**  
Parent: [generic service spec](2026-08-29-generic-open-source-service-spec.md) §5.5/§6  
Review: [Phase 5 architecture review](../reviews/2026-08-30-phase-5-chat-sse-orchestrator-review.md)
Companion: [Phase 5B durable agent coordination and handoffs](2026-08-31-durable-agent-coordination-and-handoffs.md)

## 1. Product summary

Phase 5 makes the durable board-agent loop conversational without creating a
second chat system. A human can open any agent-backed task as a conversation,
watch safe live progress, reconnect without losing events, send a follow-up that
starts a new isolated attempt, or create a new chat represented underneath as a
normal board task.

Projects may also register an opt-in orchestrator agent. It can answer directly
or request a bounded worker run through harness-clamped tools. Direct worker
assignment remains the default and cheapest path.

The board remains authoritative for work. Sessions/events remain authoritative
for conversation. `agent_runs` remains authoritative for worker attempts.

Delivery is split into two release lanes under the Phase 5 umbrella. Phase 5A
contains the shared chat/SSE/direct-conversation foundations and may ship first.
Phase 5B adds durable parent/child delegation and typed handoffs using the companion
spec above; it may develop alongside Phase 5A only after shared profile, message, and
task-stream contracts are frozen.

## 2. Problems to solve

- The drawer is board activity plus raw output, not one readable conversation.
- The browser polls; there is no server SSE route or durable task cursor.
- Pi output/tool events are buffered until the sandbox process exits.
- Handoffs can span sessions, while ordering exists only within each session.
- Follow-up acceptance is check-then-update and has no idempotency key.
- Board ownership and the agent to reply to are conflated.
- `actor: orchestrator` can be routed but no shipped role executes it.
- The native `EventSource` stub cannot send the current bearer header.

## 3. Users and jobs

1. **Continue a task:** ask for a correction after review/failed/done and resume
   conversation plus the optional prior workspace.
2. **Start with chat:** send a message to a registered chat-capable agent or the
   project default; receive an ordinary task/session/run record.
3. **Coordinate through an orchestrator:** ask a project agent that may answer or
   dispatch one allowed specialist and synthesize the result.
4. **Observe live work:** see assistant text, safe tool status, attempts, handoffs,
   snapshots, and artifacts with reconnectable delivery.

## 4. Goals and measures

- One ordered task timeline across sessions, attempts, and child sessions.
- p95 persisted-event-to-browser latency below 1 second locally and 2 seconds in
  split Compose.
- Reconnect from the last cursor with no missing or duplicate rendered item.
- Same-id concurrent message submission creates one input and at most one attempt.
- `POST /api/chats` returns before control routes and does not require a session id.
- Direct-chat and orchestrator-child Docker e2e tests pass unattended.
- No raw tool args/results, provider payloads, or secrets in viewer events.

## 5. Non-goals

- WebSocket, mid-turn interruption, or queued messages while a run is active.
- Warm sandbox reuse; v1 remains attempt-per-message with a fresh sandbox.
- Parallel/nested orchestration beyond the limits below.
- Workflow-graph UI or a general-purpose assistant unrelated to board tasks.
- External chat channel implementations.
- Multi-tenant auth/OIDC/RBAC (Phase 6), though every new boundary carries
  tenant/project context.

## 6. Non-negotiable invariants

1. API records intent; control alone creates routed sessions.
2. Worker alone owns sandbox execution and credentials needed for it.
3. Orchestrator requests are untrusted; the harness authorizes and clamps them.
4. Fresh immutable profile/scope/tool/skill/credential envelopes always override
   restored workspace files.
5. Exact profile version/hash and resolved skills are pinned at route/dispatch.
6. Postgres notification is a wake-up only; reconnect correctness uses durable rows.
7. Chat exposes an allowlisted projection, never raw session/provider events.
8. Direct board-to-worker routing remains supported and unchanged.

## 7. Target architecture

```text
Browser: REST writes + JSON catch-up + fetch-SSE
                         |
API: commands, views, redacted timeline, SSE fanout
                         |
Postgres: board + sessions/events + agent_runs
          task_commands + orchestration_turns + task_stream_events/NOTIFY
              ^                 ^                 ^
              |                 |                 |
         control role       worker role     orchestrator role
         route + pin        sandbox/run     scoped model turns
```

The new `--role orchestrator` is a least-privilege control-plane execution
service. It is separate from deterministic control because model/provider latency
must not block routing and the model must not share control authority. It has a
model credential and scoped tool handlers, but no filesystem, shell, Docker,
snapshot, repo, promotion, or sandbox-launch authority. It is never network
reachable.

## 8. Domain and persistence

### 8.1 Task kind

Add `TaskKind = 'work' | 'chat'` and non-null `board_tasks.task_kind`, default
`work`. Index `(project_id, task_kind, updated_at)`. Chat is a classification/lens,
not separate persistence.

### 8.2 Reply target versus assignee

The task view gains a server-managed conversation projection:

```ts
conversation: {
  agentId: string | null;
  profileRef: { id: string; version: number; contentHash: string } | null;
  latestSessionId: string | null;
  busy: boolean;
}
```

Handoff to a human changes queue ownership but does not erase the last valid
conversation agent. A recipient change must resolve to a registered chat-enabled
agent in the same tenant/project.

### 8.3 Exact profile pinning

Every worker/orchestrator session records `{profileId, version, contentHash,
source}`. File profiles receive deterministic version/hash identities. Claim loads
the pinned document; “latest at claim” is prohibited.

### 8.4 Durable task stream

Add a derived delivery log with an atomic per-task counter:

```sql
task_stream_counters(task_id primary key, next_index bigint not null);
task_stream_events(
  task_id text not null,
  event_index bigint not null,
  tenant_id text not null,
  project_id text not null,
  source_type text not null,
  source_id text not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(task_id, event_index)
);
```

It references/project safe views from task/session/run mutations and can be
rebuilt; it is not canonical conversation storage. Child sessions carry immutable
`boardTaskId` even when they have no `channel_origin`. Inserts notify one stable PG
channel with only `{taskId,nextIndex}`.

### 8.5 Idempotent task commands and messages

Each message has `clientMessageId` and a request hash. Same id/body returns the
original receipt; same id/different body returns 409. One transaction must lock
the task, validate/dedupe, insert a durable `task_commands(kind='message')` intent,
and append/notify the optimistic safe user-message item in the task stream.

The API does not move a session to `routing`. Control claims pending task commands
and transactionally locks the conversation, rejects or applies busy state,
resolves the pinned reply target, reopens/increments once, stamps the resume ref,
appends canonical `channel.input`, and marks the command applied. A rejected
command emits a visible task-stream result. This preserves the HTTP-only API and
control-owned scheduling boundary.

`task_commands` is a generic durable command/receipt queue, not chat history. It
stores tenant/project/task, kind, idempotency key, request hash, bounded payload,
status (`pending|processing|applied|rejected`), result/error code, claim lease, and
timestamps. Unique scope is tenant/project/actor/kind/idempotency key.

New-chat task creation, assignment intent, and idempotency receipt are also
atomic. Normal assignment polling routes it asynchronously.

### 8.6 Orchestration turn ledger

Add `orchestration_turns`: id, session id, turn number, status, pinned profile
id/version, processed-through event index, lease owner/generation, timings,
summary/error/finish reason, and token usage. One live turn per parent session.
Claims use `FOR UPDATE SKIP LOCKED`; lifecycle state does not hide in JSONB.

## 9. Public timeline

Stable item kinds:

- `message.user`, `message.assistant.delta`, `message.assistant.final`
- `run.queued`, `run.started`, `run.status`, `run.completed`
- `tool.started`, `tool.completed`
- `handoff.changed`, `artifact.available`, `system.warning`
- `orchestrator.dispatch.requested|accepted|denied`

Every item includes task index, task/session id, attempt number, typed actor,
timestamp, and bounded data. Tool items expose name/status/timing and a safe
harness label, not args/results. Shell output, file bodies, env, provider payloads,
credentials, and stack traces never enter viewer events. Oversized text is
truncated with an explicit marker.

Attempt boundaries, agent handoffs, orchestrator-child dispatch, and return to the
parent stay visible. Raw session-event inspection remains a later role-gated
operator surface.

## 10. HTTP API

All routes use one actor-resolution helper, which Phase 6 replaces without
changing call sites.

### Create chat

```http
POST /api/chats
Idempotency-Key: <opaque id>

{ "message": "...", "agentId": "agent-assistant", "repos": [] }
```

Agent resolution: explicit registered `agentId` -> project
`chat.defaultAgentId` -> local compatibility env
`REMOTE_AGENT_CHAT_DEFAULT_AGENT_ID` -> 400. Never accept raw `profileId`.
Validate project membership, chat eligibility, repo/scope, and size. Zero repos is
the default. Title is a bounded deterministic first-line derivation, not another
model call.

```http
202 Accepted
{
  "chatId":"<taskId>", "taskId":"<taskId>", "status":"accepted",
  "timelineUrl":"/api/tasks/<id>/timeline",
  "eventsUrl":"/api/events/tasks/<id>"
}
```

### List/read chat

`GET /api/chats?status=&cursor=&limit=` and `GET /api/chats/:id` are paginated
task-kind filtered views. They must not load the whole board.

### Send message

Canonical route:

```http
POST /api/tasks/:id/messages
{
  "clientMessageId":"...", "text":"...",
  "resumeWorkspace":true, "recipientAgentId":null
}
```

`POST /api/chats/:id/messages` is an alias. Existing `/follow-up` delegates to the
same command as a compatibility wrapper. Resume defaults true when a restorable
snapshot exists. Busy worker/orchestrator work returns retryable 409; v1 does not
queue. Human board ownership does not block a valid reply target.

Response is a durable 202 command receipt with task id, command id, client message
id, accepted time, deduplicated flag, and next event index. Acceptance means
durably queued, not yet applied to a session.

### Catch-up and SSE

- `GET /api/tasks/:id/timeline?after=&limit=` returns ordered items,
  `nextAfter`, and `hasMore`.
- `GET /api/events/tasks/:id?after=` returns SSE.

The SPA uses fetch-based SSE to send the bearer header. Tokens in query strings
are forbidden.

## 11. SSE contract

Durable frames:

```text
id: <task event index>
event: task.timeline
data: <one-line JSON item>

```

Send `retry: 3000`, an `task.up_to_date` control event, and comment heartbeat
every 15 seconds. Use `text/event-stream`, `no-cache, no-transform`, keep-alive,
no compression, and disable proxy buffering where supported.

Algorithm: resolve `Last-Event-ID`/`after`; send bounded catch-up; register task
interest; catch up again to close the race; on notification query durable rows;
disconnect slow clients rather than buffering without limit. Client dedupes by
`taskId:index` and reconnects with its last processed id.

Document connection limits, event size, batch/page limits, heartbeat, write/idle
timeouts, and planned stream lifetime.

## 12. Live Pi runner protocol

Change the sandbox adapter from buffered `exec()` to existing `spawnStream` and a
versioned JSONL stdout protocol. Stderr is bounded debug output.

Frames: `ready`, `assistant.delta`, `tool.started`, `tool.completed`, and `result`,
each with protocol/version and monotonic runner sequence. Validate version, type,
and maximum line size. Unknown types create a bounded warning; malformed/oversized
frames follow an explicit fail/drop policy.

Coalesce assistant deltas and persist at the first of 250 ms, 1 KiB, or turn end.
Persist one canonical final `assistant_message` for model replay; delta fragments
are not replayed. Tool progress is published while the process runs. A provider
without attached streaming degrades to lifecycle plus final output without
changing the task stream contract.

## 13. Direct chat

A profile opts in without gaining authority:

```yaml
interfaces:
  chat:
    enabled: true
```

External callers select a registered board agent. The exact profile is pinned
server-side. Direct chat is normal control -> worker routing and reopens the same
worker session per message. The repo may ship a zero-repo `assistant` worker
profile; existing coder/reviewer/author profiles are not silently made defaults.

## 14. Project/tenant orchestrator

### Policy

Project config adds:

```json
{
  "chat": {
    "defaultAgentId": "agent-project-orchestrator",
    "allowedAgentIds": ["agent-project-orchestrator", "agent-assistant"],
    "maxMessageBytes": 32768
  },
  "orchestration": {
    "enabled": true,
    "allowedWorkerAgentIds": ["agent-coder", "agent-reviewer", "agent-author"],
    "maxChildRunsPerConversation": 4,
    "maxParallelChildren": 1,
    "maxDepth": 1,
    "maxRuntimeMinutes": 15,
    "maxToolCallsPerTurn": 4,
    "maxTurnsPerConversation": 12,
    "maxTotalTokens": 120000,
    "maxCostUsd": null
  }
}
```

Server ceilings override project values. Missing `enabled` means false. No tool
accepts tenant/project override.

### Tools

- `list_worker_agents`: safe bounded descriptions of allowlisted registered
  workers; no prompts, credentials, paths, or raw documents.
- `dispatch_worker(agentId, goal, contextNotes?, targetPaths?, repos?)`: validates
  depth/child/parallel/budget, resolves exact worker profile, clamps
  `request ∩ orchestrator policy ∩ worker policy ∩ project policy`, and creates
  one child `actor=worker,status=routing` with `parent_session_id`, task id, and
  `completionMode=return_to_parent`.
- `finish_conversation(reason?, handoffToHuman?)`: bounded harness command; cannot
  name arbitrary principals.

The orchestrator has no OS or general network tools. A managed child's `handoff`
cannot bypass the parent or reassign the board; it becomes a completion suggestion
or is denied. Valid MR/artifact intents may still be harness-applied to the task.

### Lifecycle

User input makes the parent ready. A turn answers directly or dispatches a child.
Child completion appends a structured parent input with status, summary, usage,
and validated artifact refs, which makes the next parent turn ready. Child failure
is data; the parent may retry within limits or explain it. Leases and reconciler
terminalize stranded turns/children exactly once.

## 15. UX

- Add a Conversation tab with readable user/assistant messages, temporary deltas,
  collapsible safe tools, attempt/session/child boundaries, handoffs, and links to
  snapshots, Runs, Changes, usage, and declared artifacts.
- Conversation is default for chat tasks. Completed deliverable tasks may still
  land on Artifacts.
- Composer distinguishes agent message from human board note, retains drafts on
  409, generates/reuses `clientMessageId`, and is disabled while work is live.
- It remains enabled for review/failed/done when a valid reply target exists even
  if the board assignee is human.
- Add `/chats`: paginated list, new-chat composer, allowed-agent selector, and deep
  link to the shared conversation component. Chat tasks remain visible on board.
- SSE invalidates/patches tasks, task, timeline, runs, usage, artifacts, and chats;
  bounded refetch remains a reconnect/terminal fallback.

## 16. Security and release boundary

Phase 5 is supported only for trusted local/private self-host deployments until
Phase 6 removes client identity headers and enforces membership/RBAC/CORS/CSRF.

Phase 5 still must reject cross-project agents, scope widening, non-allowlisted
dispatch, depth/child/parallel/budget overflow, child handoff bypass, oversized
messages/frames, and auth failure before SSE headers. Synthetic secrets in tool
output must not reach timeline/SSE. Provider/repo keys must not appear in runner
frames, prompts, workspaces, snapshots, task/session events, or URLs.

## 17. Reliability and operability

- API command acceptance is one transaction; control command application/reopen is
  another fenced transaction. Projections are atomic with the source where
  practical and repaired by reconciliation otherwise.
- API/worker/orchestrator restarts preserve cursors, leases, and durable state.
- Metrics cover message accept/dedupe/reject, projection lag, SSE connection/
  reconnect/backlog/slow-client drop, event latency, runner protocol errors,
  orchestration turns/tokens/cost, dispatch denials, child limits, and hydration.
- Logs carry tenant/project/task/session/attempt-or-turn/lease identifiers but omit
  message bodies and secrets by default.
- API readiness includes DB/task-stream listener. Orchestrator readiness includes
  DB/profile/provider but not Docker. Shutdown stops claims/connections and drains
  bounded work.

Initial ceilings: 32 KiB user message, 256 KiB final assistant text, 16 KiB public
event, timeline page 100/max 500, SSE batch 200, delta 250 ms/1 KiB, heartbeat 15 s,
orchestrator depth/parallel child both 1.

## 18. Ordered workstreams

### P5-00 — Baseline/contracts

Fix the stale migration test; freeze task-kind, profile-ref, message-receipt,
timeline, and runner-frame contracts. Evidence: check/test green excluding explicit
environment gates; serialization tests; no behavior change.

### P5-01 — Exact profile pinning

Unify version/hash identity for file and DB profiles; stamp at route; load exact at
claim. Evidence: update after route does not change execution; restore cannot
override; run/turn exposes ref.

### P5-02 — Task stream/projector

Add migrations/repos/counter/notification, safe projector, in-memory port, and JSON
catch-up. Evidence: concurrent contiguous indexes; ordered two-session handoff;
secret redaction; exact cursor catch-up.

### P5-03 — SSE

Add auth, framing, replay-subscribe-replay, heartbeat, limits/backpressure,
shutdown, and fetch client. Evidence: disconnect/API restart no gaps; duplicates
deduped; slow client bounded; no token URL.

### P5-04 — Live runner

Add JSONL/spawnStream, deltas/tools, coalescing, final canonical message, protocol
limits, provider degradation. Evidence: slow fake model emits before exit; correct
ordering/replay; malformed/oversized frames bounded.

### P5-05 — Atomic messages

Add durable command receipts, fenced control application, transactional
dedupe/reopen/input, and reply-target semantics; keep follow-up wrapper. Evidence:
same-id concurrency one command/input/attempt; mismatched replay 409; API never
sets routing; human assignee can reply; fresh policy wins on restore.

### P5-06 — Task conversation UI

Build transcript/composer/boundaries/tools/artifact links/SSE cache behavior.
Evidence: component tests for direct, failed, handoff, reconnect, multi-attempt;
accessibility live-region/focus/keyboard/reduced-motion pass.

### P5-07 — Chat intake/UI

Add task kind, project chat config, registered-agent validation, idempotent 202 API,
pagination, aliases, `/chats`, and zero-repo default. Evidence: API never routes;
retry one task; cross-project rejected; default direct chat completes.

### P5-08 — Orchestrator turns/runtime

Add ledger, atomic claim/finalize/reap, `--role orchestrator`, health/shutdown and
Compose. Evidence: replicas never double-run; crash reconciled once; input wakes
one turn; role starts with no Docker/snapshot credential.

### P5-09 — Orchestrator tools/children

Add safe catalog, dispatch/finish, policy ceilings, scope clamp, parent/child
linkage and return-to-parent completion. Evidence: direct answer; child wake-up;
denial matrix; child cannot bypass; direct worker path unchanged.

### P5-10 — Orchestrated chat UX

Render parent/child lifecycle, limits/failure, child attempts/artifacts. Evidence:
direct/delegated UI tests; active child disables conflicting input; bounded retry.

### P5-11 — Operational hardening

Add metrics, projection repair/retention, SSE load/backpressure, fuzz/size/security
tests, dependency check, and runbooks. Evidence: restart/load/negative matrix green;
no unbounded buffer or dispatch loop.

### P5-12 — E2E/docs release gate

Prove task follow-up+restore, direct chat, orchestrator-child-parent, and live
disconnect/reconnect. Run host `api --with-worker` Docker and split
API/control/worker/orchestrator/reconciler topology. Update architecture,
development tracker, `.env.example`, Compose, examples, AGENTS, and handoff.

## 19. Verification matrix

| Layer | Required proof |
|---|---|
| Persistence | task indexes, dedupe, exact profile load, fenced turn claims |
| API | 202 semantics, validation, pagination, auth-before-stream |
| SSE | catch-up/race/reconnect/restart/heartbeat/slow client |
| Runner | live ordering/coalescing/final replay/protocol abuse |
| Continuation | review/failed/done, human assignee, concurrency, resume precedence |
| Orchestrator | direct/child/denials/budgets/crash recovery |
| UI | states, boundaries, artifacts, drafts, reconnect, accessibility |
| Security | cross-project, scope widening, handoff bypass, redaction, token absence |
| E2E | local Docker, full split, and live provider pre-completion update |

Local tests do not establish live-provider, Docker, concurrency, or split-process
proof; record those gates separately.

## 20. Exit criteria

1. A completed task accepts an idempotent message, optionally restores workspace,
   records attempt 2, and displays both attempts in one conversation.
2. SSE delivers redacted live output and reconnects from a durable task cursor.
3. Message/create retries do not duplicate tasks, inputs, turns, or attempts.
4. Default-agent `POST /api/chats` returns 202 and eventually produces ordinary
   board/session/run records.
5. Human board ownership does not destroy a valid conversation target.
6. A project orchestrator answers directly or runs one allowed child and returns
   its validated artifacts.
7. Agent/scope/depth/child/parallel/runtime/tool/token/cost limits have audited
   server-side enforcement.
8. Worker and orchestrator use pinned profile/skill envelopes.
9. Split roles pass with correct credential/sandbox boundaries; clean check/tests,
   Docker integration, and live Phase 5 e2e are green.
10. Docs clearly block untrusted/shared multi-tenant release until Phase 6.

## 21. Decisions to approve before execution

1. Separate `--role orchestrator`, not model execution inside API/control.
2. Durable per-task event projection, not a compound multi-session SSE cursor.
3. First-class `task_kind`, not a JSONB convention.
4. Registered `agentId` at intake; exact profile version pinned server-side.
5. Orchestration v1 depth 1, one active child, no orchestrator-to-orchestrator.
6. Attempt-per-message and fresh sandbox; warm reuse later.
7. Redacted viewer timeline separate from raw operator events.

After review approval, §18 should be split into independently executable task
documents under `docs/tasks/in-progress/` without low-level code recipes.
