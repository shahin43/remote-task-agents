# Later — Phase 5: chat + SSE + profile chat orchestration

Spec: [2026-08-29-chat-orchestration.md](../../specs/2026-08-29-chat-orchestration.md)
(expanded into a PRD/delivery spec after the 2026-08-30
[architecture review](../../reviews/2026-08-30-phase-5-chat-sse-orchestrator-review.md)).
It is draft-for-review, not yet an implementation work order. Supersedes the old
"phase-5-chat-and-config-ui" — agent-config UI moved to
[phase-7-agent-config-ui.md](phase-7-agent-config-ui.md).

Durable parent/child delegation, structured child return, and typed ownership
handoffs are detailed separately in
[Phase 5B durable agent coordination](phase-5b-durable-agent-coordination.md).
Phase 5A direct chat may ship before Phase 5B; both reuse the same task timeline,
message command, profile pinning, SSE, and conversation UI contracts.

Exit: spec §20 — atomic follow-up resumes the workspace live over reconnectable
SSE; `POST /api/chats` is handled as a normal board task; an opt-in project
orchestrator can safely dispatch one bounded child worker and return its result.

## Review gates before moving to `in-progress/`

- [ ] Approve separate `--role orchestrator` and its credential boundary
- [ ] Approve durable per-task event projection and cursor contract
- [ ] Approve first-class `task_kind` and registered-`agentId` intake
- [ ] Approve v1 orchestration limits (depth 1, one active child)
- [ ] Convert spec §18 workstreams into independently executable task documents

## Delivery workstreams

- [ ] P5-00 baseline/contracts
- [ ] P5-01 exact profile pinning
- [ ] P5-02 task stream and redacted projector
- [ ] P5-03 resumable SSE and fetch client
- [ ] P5-04 live Pi runner protocol
- [ ] P5-05 atomic idempotent message command
- [ ] P5-06 task conversation UI
- [ ] P5-07 chat intake, task kind, and Chats UI
- [ ] P5-08 orchestrator turn ledger/runtime
- [ ] P5-09 scoped orchestrator tools and child sessions
- [ ] P5-10 orchestrated-chat UX
- [ ] P5-11 operational hardening
- [ ] P5-12 split/live e2e and documentation gate

P5-08 through P5-10 and the orchestration portions of P5-11/P5-12 are expanded by
the Phase 5B workstreams. Do not implement competing turn, delegation, handoff,
timeline, or usage models in the two lanes.

Identity note: chat v1 ships under the local bearer posture; it is not for
untrusted/shared deployments until Phase 6. Phase 5 still requires scoped agent
resolution, redacted events, bounded SSE, and orchestrator policy enforcement.
