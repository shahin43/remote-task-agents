# Phase 5B specification — durable agent coordination and handoffs

Date: 2026-08-31  
Status: **draft for architecture review — not an implementation work order**  
Parent: [Phase 5 chat, SSE, and project orchestrator](2026-08-29-chat-orchestration.md)  
Research input: [Hermes Agent implementation review](../hermes-agent-implementation-review-2026.html)  
Tracker: [Phase 5B later-phase checklist](../tasks/later/phase-5b-durable-agent-coordination.md)

## 1. Decision summary

Add durable agent coordination as **Phase 5B**, sharing the Phase 5 chat foundations
but remaining independently releasable.

- **Phase 5A** makes an ordinary board task conversational: exact profile pinning,
  one task timeline, durable message commands, live runner events, SSE, direct chat,
  and the conversation UI.
- **Phase 5B** adds a least-privilege project orchestrator, durable parent/child
  delegation, structured child returns, and policy-controlled board handoffs.

Direct board-to-worker routing remains the default and does not depend on an
orchestrator. Phase 5A may ship without Phase 5B. Phase 5B may be developed alongside
the later Phase 5A workstreams only after the shared persistence and profile contracts
listed in §4 are frozen.

The architectural rule is:

> The board owns work, sessions own conversations, `agent_runs` owns sandbox
> attempts, `orchestration_turns` owns orchestrator model turns, and `delegations`
> owns parent/child work transfer. Chat is a projection over those records, not a
> second source of truth.

## 2. Problem statement

The current service can route a board task directly to a profile, run an isolated
worker, persist session events, snapshot the workspace, and apply an agent-authored
handoff. It does not yet provide a durable protocol for an orchestrator to:

1. hold a multi-turn conversation with a human;
2. select one allowed specialist without accepting arbitrary profile or project
   identifiers from the model;
3. create an isolated child session with an immutable execution envelope;
4. survive API, orchestrator, worker, or reconciler restarts;
5. receive a structured child result exactly once;
6. explain, retry, request review, or return control to a human; and
7. expose the complete lifecycle through the same reconnectable task timeline used
   by chat.

The existing handoff path also combines two different meanings:

- **returning a result to a parent orchestrator**, which must not change board
  ownership; and
- **transferring board ownership**, which is a control-plane side effect.

Those operations require separate contracts.

## 3. Product outcomes

### 3.1 Primary scenario

A user starts or opens a chat task and asks the project orchestrator to achieve an
outcome. The orchestrator either answers directly or delegates one bounded unit of
work to an allowlisted worker. The user sees the child lifecycle, safe progress,
attempt usage, artifacts, and the orchestrator's final synthesis in one conversation.

Example:

```text
User: Review the authentication implementation and fix critical issues.
  -> orchestrator turn 1
  -> dispatches agent-reviewer
  -> reviewer child returns findings
  -> orchestrator turn 2
  -> dispatches agent-coder with bounded findings
  -> coder child returns patch + tests + snapshot
  -> orchestrator turn 3
  -> summarizes outcome and requests human review
```

Phase 5B v1 permits the sequence above, but only **one child may be active at a
time**, delegation depth is **one**, and every dispatch consumes a conversation-level
budget.

### 3.2 Secondary scenarios

- Ask the orchestrator for project/task status without dispatching a worker.
- Delegate research or document creation to a zero-repo worker.
- Request a reviewer after a code worker returns.
- Retry a failed child within configured limits.
- Hand a conversation to a human without losing the valid reply agent.
- Continue the same orchestrator conversation after task review or completion.

### 3.3 Success measures

- A committed child completion wakes exactly one parent turn.
- Concurrent/retried dispatch requests create at most one child session.
- A child cannot change task ownership or select its successor.
- Orchestrator, worker, API, control, and reconciler restarts do not lose or
  duplicate a delegation result.
- Every orchestrator and child model call is attributable by tenant, project, task,
  session, turn/delegation, attempt, profile version, tokens, and estimated cost.
- A browser reconnect from its last task cursor renders no missing or duplicate
  delegation/handoff item.
- Direct worker routing has no behavior or latency regression when orchestration is
  disabled.

## 4. Relationship to Phase 5 chat

### 4.1 Shared prerequisites

Phase 5B MUST reuse, not duplicate, these Phase 5A foundations:

| Phase 5A foundation | Why Phase 5B depends on it |
|---|---|
| P5-01 exact profile pinning | Parent and child must execute immutable profile/skill/policy envelopes. |
| P5-02 task stream/projector | Parent and child sessions need one task-wide ordered viewer cursor. |
| P5-03 SSE | The chat UI observes delegation and handoff through the shared task stream. |
| P5-05 atomic message commands | Parent conversations require idempotent input and fenced busy-state handling. |
| P5-06 conversation component | Orchestrated chat extends the same transcript, boundary, artifact, and usage UI. |
| P5-07 registered chat intake | External clients select registered agents, never raw profile documents. |

### 4.2 Parallelization boundary

After P5-01, P5-02, and the message/timeline contracts from P5-05 are frozen:

- Phase 5A can continue with SSE, live runner output, direct-chat UI, and `/chats`.
- Phase 5B can build the orchestrator ledger, delegation repository, policy engine,
  and runtime using in-memory/fake task-stream ports.
- Integration begins only when both lanes conform to the frozen task timeline and
  message/command contracts.

No Phase 5B migration or service role may be required for a Phase 5A-only deployment.

### 4.3 Recommended release sequence

1. Release Phase 5A direct task chat behind trusted/private deployment guidance.
2. Run restart, reconnect, idempotency, redaction, and live-provider gates.
3. Enable Phase 5B for one project with one orchestrator and one active child.
4. Expand to sequential multi-child conversations only after usage, failure, and
   budget enforcement evidence is available.

## 5. Non-goals

- A social chat room in which agents exchange unrestricted prose.
- Shared mutable memory between orchestrator and workers.
- Worker-to-worker direct messaging.
- Nested delegation or orchestrator-to-orchestrator delegation.
- Multiple active children in v1.
- Warm sandbox or live process reuse between messages.
- Model-controlled tenant, project, profile version, credentials, capability set,
  cost ceiling, or board principal.
- A workflow graph designer.
- Replacing direct board assignment, same-card review, or human control.
- External Slack, Teams, WhatsApp, or mobile delivery implementations.
- Cross-project delegation.

## 6. Non-negotiable invariants

1. **Control owns work admission.** API and models record requests; control applies
   routing and board ownership changes.
2. **The orchestrator is not control.** It is a least-privilege model runtime whose
   tool calls are untrusted proposals evaluated by harness policy.
3. **Workers own sandbox execution only.** They cannot write orchestration or board
   tables directly.
4. **A fresh immutable envelope wins.** Restored workspace files, summaries, memory,
   or child output cannot widen current project/profile policy.
5. **Every transition is durable before notification.** PostgreSQL notification and
   SSE are wake-up/delivery mechanisms, never the source of truth.
6. **One live parent turn and one live child per conversation in v1.** Enforcement is
   database-backed and safe under concurrent replicas.
7. **A child returns to its parent.** A managed child cannot reassign the board,
   dispatch another worker, or hand off around the parent.
8. **Board ownership and conversation reply target are distinct.** Human ownership
   does not erase the valid agent that may answer the next message.
9. **Viewer events are allowlisted projections.** Raw prompts, tool arguments/results,
   provider payloads, environment, file contents, and secrets never enter SSE.
10. **Terminalization is exactly once.** Lease generations fence late workers and
    reconcilers.

## 7. Domain model

### 7.1 Durable profile identity

An agent is the stable selectable identity. A profile version is the immutable
execution definition.

```ts
interface ProfileRef {
  profileId: string;
  version: number;
  contentHash: string;
  source: 'file' | 'database';
}
```

Every worker and orchestrator session MUST store `profile_id`, `profile_version`,
`profile_content_hash`, and `profile_source` as first-class typed columns. Extended
resolved policy may use repository-owned JSON only when the contract is strictly
decoded and the immutable hash covers it. Claim-time resolution of “latest profile”
is prohibited.

The route/dispatch transaction pins:

- registered `agentId`;
- `ProfileRef`;
- engine/provider/model selection;
- resolved skills with content hashes;
- capabilities and scope policy;
- repositories/mount strategy;
- tool/runtime/token/cost ceilings; and
- handoff policy.

Memory is not added by this phase. A later memory feature must use an explicit
tenant/project/profile namespace, provenance, retention, and approval policy; it must
not turn a mutable profile directory into distributed authority.

### 7.2 Session roles and lineage

Existing `sessions.actor` remains the typed role discriminator.

| Actor | Parent | Execution owner | Purpose |
|---|---|---|---|
| `orchestrator` | null for conversation root | orchestrator role | Human conversation, dispatch decisions, synthesis. |
| `worker` direct | null | worker role | Existing direct board assignment. |
| `worker` managed child | orchestrator session | worker role | One bounded delegated unit of work. |

Required durable identity fields:

- `board_task_id`
- `tenant_id`
- `project_id`
- `parent_session_id`
- `root_session_id`
- pinned profile identity
- routing/lease generation

`parent_session_id` expresses immediate lineage. `root_session_id` makes task-wide
queries and authorization explicit without repeatedly walking metadata. The board
task remains the aggregate linking all sessions and attempts.

### 7.3 Orchestration turn

`orchestration_turns` records one model turn for the parent session:

```text
id, tenant_id, project_id, board_task_id, session_id, turn_number,
status, input_through_event_index, profile_id, profile_version,
profile_content_hash, lease_owner, lease_generation, lease_expires_at,
started_at, ended_at, finish_reason, summary, error_code,
input_tokens, output_tokens, cached_tokens, estimated_cost_usd,
created_at, updated_at
```

Statuses:

```text
ready -> claimed -> running -> waiting_child -> succeeded
                  \-> succeeded | failed | cancelled
claimed/running -> expired -> reconciled
waiting_child -> cancelled
```

Constraints:

- unique `(session_id, turn_number)`;
- at most one live turn for a parent session;
- claim uses `FOR UPDATE SKIP LOCKED` plus a lease generation;
- a late owner cannot finalize after its lease generation changes; and
- usage is finalized even when the turn fails after a provider call.

`waiting_child` is durable but owns no model-runtime lease. The dispatch transaction
clears the orchestrator lease after committing the child. Child terminalization
changes that waiting turn to `succeeded` (or `cancelled`) and inserts exactly one next
`ready` turn. Therefore a slow child does not pin an orchestrator process or create a
false expired-turn alarm.

### 7.4 Delegation

`delegations` is the authoritative parent/child transfer record:

```text
id, tenant_id, project_id, board_task_id,
parent_session_id, parent_turn_id,
requested_agent_id, resolved_agent_id,
resolved_profile_id, resolved_profile_version, resolved_profile_content_hash,
child_session_id, child_run_id,
status, completion_mode, request_hash, idempotency_key,
goal, context_notes, target_paths, repos,
lease_generation, requested_at, admitted_at, started_at, ended_at,
result_status, result_summary, result_payload,
input_tokens, output_tokens, cached_tokens, estimated_cost_usd,
error_code, created_at, updated_at
```

Statuses:

```text
requested -> admitted -> routing -> running -> returned
          \-> denied
routing/running -> failed | cancelled | expired
expired -> reconciled
```

Database constraints:

- unique parent-scoped idempotency key;
- one active delegation per parent session in v1;
- one child session belongs to at most one delegation;
- child tenant/project/task must equal the parent envelope; and
- terminal rows are immutable except for bounded reconciliation metadata.

`goal`, `context_notes`, paths, and repos are bounded request data. Provider
credentials, raw profile documents, hidden prompts, and arbitrary environment values
are forbidden. The request hash covers the normalized model-visible fields; reuse of
the same key with different content is rejected.

### 7.5 Delegation completion envelope

The child does not send a free-form message directly to the parent. The worker
finalizer produces a typed envelope:

```ts
interface DelegationCompletion {
  delegationId: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'expired';
  summary: string;
  outcome: {
    kind: 'work_completed' | 'review_recommended' | 'needs_input' | 'no_change';
    recommendation?: string;
  };
  artifacts: Array<{
    artifactId: string;
    kind: string;
    contentHash?: string;
  }>;
  snapshotRef: { store: string; id: string } | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    estimatedCostUsd?: number;
  };
  evidence: {
    checksRun?: number;
    checksPassed?: number;
    declaredFiles?: string[];
  };
  errorCode?: string;
}
```

The harness rebuilds this envelope from authoritative run, artifact, and snapshot
records. It does not trust artifact IDs, cost, status, or snapshot references emitted
by the model. Text fields are length-bounded and redacted before parent/timeline use.

### 7.6 Handoff command

Board ownership transfer is separate from delegation return. Extend the Phase 5
generic `task_commands` repository with `kind='handoff'` and the following strictly
decoded payload; do not introduce a second command queue:

```ts
interface TaskHandoffCommand {
  commandId: string;
  taskId: string;
  kind: 'ownership_transfer' | 'request_review' | 'return_to_human';
  from: { agentId?: string; sessionId: string; runId?: string };
  requestedTarget: { kind: 'agent' | 'user'; id?: string };
  reason: string;
  summary?: string;
  delegationId?: string;
  expectedTaskVersion: number;
  idempotencyKey: string;
}
```

Control resolves the target against project registration and handoff policy, applies
the mutation with compare-and-swap, and records `applied` or a stable denial code.
The model cannot name an arbitrary user. `return_to_human` resolves a server-owned
principal such as the creator or configured reviewer.

## 8. Authority and service ownership

| Component | May do | Must not do |
|---|---|---|
| API | Authenticate/resolve actor, validate size, store idempotent message/handoff intent, serve views/SSE | Route sessions, call models, launch sandboxes, apply ownership directly |
| Control | Pin profiles, apply commands, create worker sessions, apply board ownership/review transitions | Call models, run tools, access Docker |
| Orchestrator role | Claim/finalize orchestrator turns, call configured model, invoke scoped harness tools | Accept network traffic, access filesystem/shell/Docker, mutate board/session rows directly |
| Worker role | Claim worker session, execute one sandbox attempt, capture events/snapshot/artifacts, finalize run | Select arbitrary successor, dispatch child, mutate parent turn |
| Reconciler | Reap expired turn/delegation/run leases, terminalize once, repair projections | Invent work, retry without policy, delete another live owner's resources |
| Postgres | Canonical durable state, fencing, idempotency, task timeline source | Act as a transient message broker only |

The agent runtime remains inside the sandbox for workers and inside the private
orchestrator service for parent turns. Neither is directly network reachable.

## 9. Orchestrator policy

Project configuration extends the Phase 5 policy:

```json
{
  "orchestration": {
    "enabled": true,
    "orchestratorAgentId": "agent-project-orchestrator",
    "allowedWorkerAgentIds": ["agent-coder", "agent-reviewer", "agent-author"],
    "maxChildRunsPerConversation": 4,
    "maxActiveChildren": 1,
    "maxDepth": 1,
    "maxTurnsPerConversation": 12,
    "maxToolCallsPerTurn": 4,
    "maxRuntimeMinutesPerTurn": 15,
    "maxRuntimeMinutesPerChild": 30,
    "maxTotalTokens": 120000,
    "maxEstimatedCostUsd": null,
    "allowedHandoffTargets": ["creator", "configured-reviewer"]
  }
}
```

Rules:

- Missing `enabled` is false.
- Server ceilings can only reduce project limits.
- No model tool accepts tenant or project parameters.
- Worker selection uses a registered `agentId`; raw `profileId` is rejected.
- Dispatch scope is
  `request ∩ orchestrator policy ∩ worker profile ∩ project policy ∩ server ceiling`.
- Empty intersection denies the dispatch; it is never silently widened.
- Budget reservation happens atomically at admission; final usage reconciles the
  reservation.
- Cost ceilings use a configured estimator and record `unknown` when pricing is
  unavailable. Unknown cost cannot bypass a non-null hard ceiling.

## 10. Orchestrator tools

### 10.1 `list_worker_agents`

Returns bounded, safe descriptions for project-allowlisted registered agents:

- `agentId`, display name, purpose, supported task types;
- safe skill labels and high-level capabilities; and
- availability/budget eligibility.

It never returns base prompts, profile documents, credentials, local paths, hidden
policy, or cross-project agents.

### 10.2 `dispatch_worker`

```ts
dispatch_worker({
  agentId,
  goal,
  contextNotes?,
  targetPaths?,
  repos?,
  idempotencyKey
})
```

The handler:

1. verifies parent turn lease ownership;
2. validates limits and message sizes;
3. resolves the agent and exact profile version server-side;
4. clamps scope and reserves budget;
5. records the request and atomically transitions it to `admitted` or `denied` with a
   stable decision code;
6. creates one child `actor='worker', status='routing'` session with parent/root
   linkage and `completionMode='return_to_parent'`;
7. appends canonical child input and task-stream projection; and
8. moves the parent turn to `waiting_child`.

Child session creation occurs only in the admitted branch and in the same transaction
as budget reservation and the parent wait transition. A denial remains auditable and
leaves the parent turn running so the model may answer without dispatch or finish the
conversation.

The response reveals the delegation ID and safe admission result, not credentials or
internal policy documents.

### 10.3 `finish_conversation`

Ends the current parent turn with an optional bounded reason and one of:

- answer directly without changing board ownership;
- request review through a typed handoff command; or
- return to the server-resolved human target.

It cannot name an arbitrary principal or mark a child successful.

No generic database, shell, file, network, channel-send, or arbitrary tool-execution
tool is available to the orchestrator.

## 11. End-to-end lifecycle

### 11.1 Direct answer

1. API durably accepts a user message command.
2. Control applies it to the pinned orchestrator session.
3. Orchestrator role claims the next turn.
4. The model answers without dispatch.
5. One canonical assistant message and usage record commit.
6. Task stream publishes safe final/timing/usage items.

### 11.2 Delegated answer

1. Steps 1–4 above occur until `dispatch_worker` is called.
2. Admission creates the delegation and child session atomically.
3. Worker claims and executes the child in a fresh sandbox.
4. Worker finalization commits the run, snapshot, artifacts, and child session end.
5. A transaction validates/builds the completion envelope, changes the delegation to
   `returned`, appends `orchestrator.child_returned` to the parent session, and makes
   one parent turn ready.
6. Orchestrator claims the next turn and synthesizes the result, dispatches the next
   sequential child within limits, or requests a human/review handoff.
7. All state changes project into the shared task timeline.

### 11.3 Child failure

Failure is parent input, not automatic parent failure.

- The completion includes a stable error code and any validated partial artifacts.
- The parent may retry only if retry, child-count, runtime, token, and cost limits
  permit it.
- The same failed delegation is never reset to running; retry creates a new
  delegation linked by `retry_of_delegation_id`.
- Exhausted policy makes the parent ready with a visible warning so it can explain or
  return to a human.

### 11.4 Cancellation

- User cancellation records a durable command.
- Control marks parent/child cancellation requested.
- Owners stop bounded work and finalize against the current lease generation.
- Reconciler terminalizes abandoned resources.
- A child result committed before the cancellation transaction remains terminal and
  is delivered; a late result after fencing is rejected.

## 12. Handoff policy

### 12.1 Managed child

A child with `completionMode='return_to_parent'`:

- may produce summary, declared artifacts, MR intent, and a recommendation;
- may not reassign the task;
- may not choose another worker;
- may not invoke project communication channels; and
- may not convert a recommendation into an ownership transition.

If the existing Pi `handoff` tool is exposed to such a child, its harness handler
must translate the request into `outcome.recommendation` or deny it. It must not run
the existing board reassignment applier.

### 12.2 Direct worker

The existing direct worker path remains valid:

- profile-owned handoff rules can request reviewer/human transfer;
- harness validates and submits a typed handoff command;
- control applies it and creates the next top-level session as today; and
- structural autobounce still prevents silent success without a terminal owner.

### 12.3 Orchestrator

Only the orchestrator may translate child recommendations into a follow-on dispatch
or handoff request. Control remains the only component that applies board ownership.

### 12.4 Review

Prefer same-card review where possible:

- implementation result stays attached to the task and delegation;
- review creates a separate reviewer child/run;
- approval, requested changes, and external blockers are typed outcomes; and
- rework dispatch creates a new delegation, preserving the original result and
  review verdict.

## 13. Public task timeline and SSE

Add these safe timeline kinds to the Phase 5 task projection:

```text
orchestrator.turn.queued
orchestrator.turn.started
orchestrator.message.final
orchestrator.dispatch.requested
orchestrator.dispatch.accepted
orchestrator.dispatch.denied
delegation.routing
delegation.started
delegation.progress
delegation.returned
delegation.failed
delegation.cancelled
handoff.requested
handoff.applied
handoff.denied
```

Every item includes task index, task/session ID, safe actor, timestamp, and applicable
turn/delegation/run/attempt IDs. Public payloads may include:

- safe status and display label;
- worker agent display identity;
- bounded summary;
- duration and normalized usage/cost;
- validated artifact IDs; and
- stable denial/error code.

Public payloads exclude model prompts, child context notes, raw tool data, hidden
reasoning, stack traces, provider response bodies, credentials, filesystem paths, and
unvalidated model output.

SSE reuses Phase 5 replay-subscribe-replay, cursor, heartbeat, batch, and slow-client
rules. No delegation-specific socket or event bus is introduced.

## 14. Chat and board UX

### 14.1 Conversation view

Render:

- human and orchestrator messages;
- explicit parent-turn boundaries;
- “delegated to …” admission/denial;
- child queued/running/returned/failed states;
- child attempt number, elapsed time, token/cost summary;
- returned summary and validated artifact/diff/snapshot links;
- review and ownership handoffs; and
- limit or reconciliation warnings.

Do not render raw orchestrator-to-child prompts as if they were user chat messages.
They may be available later in a privileged audit view.

### 14.2 Composer

- Disabled while a parent turn or child is live.
- Retains the draft on retryable 409.
- Reuses a stable `clientMessageId` across retries.
- Remains available when the board owner is human if a valid conversation reply
  agent remains.
- Clearly distinguishes “message agent” from “add board note”.

### 14.3 Board card

The board remains a work view, not an agent topology view. A card may show compact
badges:

- orchestrator waiting;
- delegated to worker;
- awaiting review/human; and
- current token/cost total.

The detailed hierarchy belongs in the task conversation/runs view.

## 15. Usage, cost, and measurable delivery

Usage must be recorded at three levels:

1. **Attempt:** existing `agent_runs.token_usage` plus normalized cost.
2. **Delegation:** aggregate of child attempts for one parent request.
3. **Conversation:** orchestrator turns plus all delegations.

Required dimensions:

- tenant/project/task;
- parent and child session;
- orchestrator turn/delegation/run;
- agent/profile version/model/provider;
- input/output/cache/reasoning tokens when available;
- estimated cost and pricing version/source;
- duration, outcome, retry count, and artifacts accepted; and
- direct versus orchestrated execution.

Cost is never trusted from the model. Provider-native usage is normalized by the
engine adapter; the server estimates cost using a versioned price catalog and records
whether the value is exact, estimated, or unavailable.

The UI shows each attempt, delegation total, and conversation total without implying
that unavailable usage equals zero.

## 16. Security and tenancy

- Resolve tenant/project/actor from authenticated server context; never accept them
  from prompts or tool arguments.
- Authorize every task, agent, artifact, snapshot, SSE stream, and message against the
  same tenant/project boundary.
- Until Phase 6 lands, Phase 5B remains limited to trusted local/private self-hosting.
- Worker and orchestrator model credentials are service-local and never persisted in
  prompts, events, snapshots, or delegation rows.
- Child scope must be a subset of both parent/project allowance and child-profile
  policy.
- Treat task text, repository content, recalled context, memory, and child summaries
  as untrusted input.
- Use allowlisted public event schemas and centralized redaction.
- Artifact references are server-resolved, authorization-bound IDs; filesystem paths
  and store URIs are not public contracts.
- Logs omit message bodies by default and carry correlation IDs only.
- Reject oversized goals, context, result summaries, runner frames, and SSE events
  before persistence/projection.

## 17. Reliability and recovery

### 17.1 Lease and fencing rules

- Orchestrator turns, delegations, and worker attempts have explicit owner,
  generation, and expiry.
- Heartbeats extend only the current generation.
- Finalization compares owner/generation inside the terminal transaction.
- Reconciler uses the same comparison and cannot overwrite a newer owner.
- Notification is sent only after commit.

### 17.2 Recovery matrix

| Failure | Required result |
|---|---|
| API dies after accepting message | Pending durable command remains; control applies once. |
| Control dies during dispatch admission | Transaction commits all delegation/child records or none. |
| Orchestrator dies before tool call | Turn lease expires; reconciler readies/retries within policy. |
| Orchestrator dies after dispatch commit | Child remains authoritative; parent is `waiting_child`. |
| Worker dies | Existing run/reconciler path finalizes failure; delegation receives one failed return. |
| Worker commits result, wake-up is lost | Durable parent input/ready state is discovered by polling after restart. |
| Parent synthesizes but SSE disconnects | Final message is durable and replayed from task cursor. |
| Late worker returns after cancellation/retry | Generation check rejects the stale result. |
| Projection row is missing | Reconciler rebuilds it from canonical task/session/run/delegation rows. |

### 17.3 Retention

- Delegation and turn rows follow task/session audit retention.
- Public task-stream events may be compacted only after a durable rebuild boundary and
  documented client cursor-expiry behavior exist.
- Snapshots/artifacts retain their existing policies; delegation rows keep references,
  not copied payloads.
- Deleting/archive operations must preserve audit requirements and never orphan an
  active child.

## 18. Observability

Metrics:

- orchestration turn queue/claim/run/terminal counts and latency;
- active/expired/reconciled turn and delegation leases;
- dispatch requested/admitted/denied by stable reason;
- child queue/start/return/failure/cancel latency;
- duplicate/idempotency conflict counts;
- profile pin/load mismatches;
- scope/budget/handoff denials;
- tokens/cost by task, profile, model, turn, delegation, and attempt;
- task-stream projection lag and repair count;
- SSE reconnect, backlog, slow-client drop, and event latency; and
- stuck parent `waiting_child` and orphan child counts.

Structured logs carry tenant/project/task/session/turn/delegation/run/lease IDs and
stable reason codes. Message bodies, prompts, tool payloads, credentials, and file
contents are excluded by default.

Readiness:

- orchestrator role: database, profile registry, model provider, turn claimant;
- worker role: existing database, sandbox provider, engine readiness;
- API: database and task-stream listener;
- reconciler: database plus lease/recovery loop.

## 19. Compatibility and migration

1. Add new tables/columns additively; existing work tasks and direct sessions remain
   valid.
2. Backfill `board_task_id`, project/tenant, root session, and profile source only
   where deterministic evidence exists; otherwise leave a clearly handled legacy
   state rather than inventing identity.
3. Do not route an orchestrator session until all required pinned-profile fields are
   present.
4. Continue reading existing `metadata.handoffContext` for legacy direct handoffs
   during one compatibility window; all new writes use typed handoff commands.
5. Provide a read-only audit/report before removing the compatibility reader.
6. `orchestration.enabled=false` is the safe rollback. It prevents new parent turns
   and dispatches without deleting durable records or affecting direct workers.

## 20. Ordered implementation workstreams

These are outcomes and evidence, not low-level coding instructions. Split each into an
independently executable task before moving Phase 5B to `in-progress/`.

### P5B-00 — Contracts and dependency freeze

Freeze ProfileRef, session lineage, orchestration turn, delegation, completion,
handoff-command, public timeline, limits, and error-code contracts. Map every shared
contract to its Phase 5A owner.

Evidence: serialization/validation tests; contract dependency table; no duplicate
message or task-stream model.

### P5B-01 — Exact durable profile/session identity

Pin exact file/DB profile identity and first-class task/root/parent coordinates at
route/dispatch. Load exact versions at claim; fresh envelopes override restored state.

Evidence: profile updated after route does not change execution; cross-profile and
restore-widening negative tests; run/turn exposes the pinned reference.

### P5B-02 — Turn and delegation persistence

Add migrations, repositories, in-memory implementations, state machines,
idempotency, active-child constraints, lease generations, and transactional
admission/return.

Evidence: concurrent claims/dispatches/finalizers; same-key same/different-payload;
stale generation rejection; integration migrations on clean and upgraded databases.

### P5B-03 — Typed handoff policy and applier

Separate child return from ownership transfer. Add validated handoff commands,
registered-target resolution, compare-and-swap application, stable denial codes, and
legacy `handoffContext` compatibility read.

Evidence: managed child cannot reassign; direct worker handoff unchanged; arbitrary
principal/cross-project/stale task version denied; autobounce remains effective.

### P5B-04 — Least-privilege orchestrator runtime

Add `--role orchestrator`, turn claim/heartbeat/finalize, model accounting, safe
shutdown, readiness, and Compose topology. It has no sandbox, Docker, filesystem,
snapshot, promotion, or general network authority.

Evidence: two replicas never run one turn; crash/restart reconciliation; dependency
and credential negative tests; runtime starts without Docker access.

### P5B-05 — Scoped catalog, dispatch, and finish tools

Implement safe worker discovery, dispatch admission, budget reservation, scope clamp,
child creation, parent wait state, and finish/handoff request.

Evidence: direct answer; admitted and denied dispatches; full agent/scope/depth/
child/runtime/tool/token/cost denial matrix; no tenant/project override surface.

### P5B-06 — Worker return and parent wake-up

Build the completion envelope from authoritative rows, validate/redact it, commit one
delegation terminal state and parent input, wake one next turn, and handle failure,
retry, cancellation, and stale results.

Evidence: crash at every commit boundary; lost notification recovery; exactly-one
parent input/turn; validated partial artifacts; retry creates a new linked delegation.

### P5B-07 — Timeline, SSE, and UX integration

Project safe turn/delegation/handoff items into the Phase 5 task stream and extend the
shared conversation UI with parent/child boundaries, status, usage, artifacts, and
failure/limit states.

Evidence: reconnect/replay with no gaps or duplicates; direct/delegated/failed/review
component tests; no raw prompt/tool/secret content; accessibility pass.

### P5B-08 — Usage, budgets, reconciliation, and operations

Normalize usage/cost, aggregate attempt/delegation/conversation totals, enforce
reservations/ceilings, reap stranded work, repair projections, add metrics, alerts,
dashboards, and runbooks.

Evidence: unknown-price behavior, budget race, orphan/stuck-child repair, restart and
load tests, bounded buffers/queues, operational drill.

### P5B-09 — E2E and release gate

Prove direct answer, one child return, sequential reviewer/coder flow, child failure
and retry, human handoff, cancellation, usage display, and SSE reconnect in host-local
and production-shaped split topology with Docker sandboxes and a live provider.

Evidence: clean-checkout build/check/tests; migration upgrade; API/control/worker/
orchestrator/reconciler Compose; live canary; recorded limits and cost; direct worker
regression gate unchanged.

## 21. Verification matrix

| Layer | Required proof |
|---|---|
| Contracts | Strict decoding, sizes, stable statuses/reasons, forward compatibility |
| Profiles | Exact pin/load, source identity, restored-state precedence |
| Persistence | Atomic admission/return, idempotency, constraints, migration upgrade |
| Concurrency | Duplicate message/dispatch, two claimers, stale lease/finalizer |
| Handoff | Child return versus ownership transfer, policy/target/CAS denials |
| Runtime | Least privilege, restart, drain, provider failure, usage finalization |
| Worker | Fresh sandbox, parent/root linkage, no handoff bypass |
| Recovery | Crash boundaries, lost notification, orphan repair, late result |
| Timeline/SSE | Ordering, redaction, replay/reconnect, backpressure, cursor expiry |
| UI | Direct/delegated/failure/review/human states, accessibility, usage semantics |
| Security | Cross-tenant/project, scope widening, prompt injection, secret canaries |
| Cost | Attempt/delegation/conversation totals, unknown pricing, budget race |
| E2E | Local Docker, split Compose, live provider, direct-worker non-regression |

Local unit/integration tests do not establish Docker isolation, split-process
correctness, live-provider streaming, concurrency, restart, or budget enforcement.
Record those gates separately.

## 22. Exit criteria

Phase 5B is complete only when:

1. A chat-enabled project can register an immutable orchestrator profile and
   allowlisted workers.
2. A human message wakes one durable parent turn.
3. The parent can answer directly or admit one bounded child.
4. A child runs in a fresh sandbox with pinned profile/skills/scope and returns one
   validated completion envelope.
5. Child completion or failure wakes exactly one next parent turn after restarts and
   lost notifications.
6. Managed children cannot reassign the board, dispatch children, select arbitrary
   principals, or widen scope.
7. Typed ownership/review/human handoffs are idempotent, policy-controlled, and
   compare-and-swap applied by control.
8. The task conversation shows ordered parent/child/handoff boundaries, validated
   artifacts, attempt/delegation/conversation usage, and reconnectable SSE.
9. Every limit has a server-side denial test and an auditable stable reason.
10. API/control/worker/orchestrator/reconciler restart and split-topology tests pass.
11. Direct board-to-worker routing and the existing live board e2e remain green with
    orchestration disabled.
12. Documentation blocks shared/untrusted multi-tenant use until Phase 6 access
    controls are complete.

## 23. Decisions required before implementation

1. Approve Phase 5A/5B as separate release lanes under the Phase 5 umbrella.
2. Approve first-class `delegations` persistence rather than encoding lifecycle in
   session metadata or events alone.
3. Approve separate child-return and board-ownership-handoff contracts.
4. Approve one active child, depth one, sequential-only orchestration for v1.
5. Approve exact immutable profile pinning as a hard prerequisite.
6. Approve dedicated `--role orchestrator` with no sandbox authority.
7. Approve attempt/delegation/conversation usage and cost attribution.
8. Approve Phase 6 as the release prerequisite for untrusted/shared multi-tenant use.

After approval, §20 must be split into task documents under
`docs/tasks/in-progress/` in dependency order.

## 24. Current implementation map

This spec extends existing seams rather than replacing them:

| Current seam | Present behavior | Phase 5B change |
|---|---|---|
| `packages/orchestrator/src/board/assignment-router.ts:82–202` | Routes a board assignment to a top-level worker or dormant orchestrator session; bridges handoff through task metadata. | Pin exact profile identity, keep direct routing, and use typed handoff commands/delegation lineage instead of new metadata writes. |
| `packages/scheduler/src/wiring/resolve-target.ts:23–38` | Resolves agent → latest profile actor and falls back to worker on load failure. | Fail closed for orchestration, require registered project membership, and return a pinned `ProfileRef`. |
| `packages/persistence/src/sessions-repo.ts:4–62` | Stores parent ID and metadata; only workers can be atomically claimed. | Add first-class task/root/profile fields; keep worker claims and add the separate turn claimant for orchestrators. |
| `packages/persistence/src/sessions-repo.ts:128–161` | Worker claim uses `FOR UPDATE SKIP LOCKED`, lease owner, and generation. | Reuse the fencing pattern in the turn/delegation repositories; do not broaden this worker-only method into model orchestration. |
| `packages/scheduler/src/wiring/session-continuation.ts:52–125` | Reopens a session and appends input through multiple writes. | Phase 5A replaces this with idempotent task-command acceptance/application; Phase 5B consumes that same command path. |
| `packages/scheduler/src/wiring/handoff.ts:1–67` | Parses sandbox sidecar and persists `metadata.handoffContext` for the next top-level agent. | Preserve compatibility reads; route new direct handoffs through `task_commands(kind='handoff')`; translate managed-child handoff into a recommendation only. |
| `packages/scheduler/src/wiring/handoff.ts:127–184` | Coerces agent handoff status and redirects self-handoff to a human/review state. | Move target/status/cycle rules into the typed control-plane handoff policy while retaining equivalent safety behavior. |
| `packages/persistence/src/agent-profiles-repo.ts:3–17` | Stores DB profile versions but exposes only latest/list-latest lookup. | Add exact version/hash lookup and deterministic file-profile identity. |
| `packages/persistence/src/agent-runs-repo.ts:3–23` | Stores one durable operational row per worker attempt. | Add normalized cost/profile linkage as needed; delegation aggregates references to run rows rather than copying attempt lifecycle. |
| `packages/contracts/src/orchestrator/profile.ts:24–51` | Defines worker runtime, tools, skills, limits, scope, and self-handoff capability. | Add chat/orchestrator interfaces and immutable orchestration policy without granting authority through skills. |
| `packages/persistence/src/agent-bus.ts` and `session-events-repo.ts` | Persists and publishes ordered per-session events. | Continue using them for canonical session replay; Phase 5 task stream provides cross-session delivery ordering. |

Implementation tasks must cite the exact current lines they change because these
files may move after Phase 5A lands.
