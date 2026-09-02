# Later — Phase 5B: durable agent coordination and handoffs

Spec:
[2026-08-31-durable-agent-coordination-and-handoffs.md](../../specs/2026-08-31-durable-agent-coordination-and-handoffs.md)

Parent:
[Phase 5 chat + SSE](../../specs/2026-08-29-chat-orchestration.md)

Exit: a project orchestrator can answer directly or run one bounded child at a
time; every parent turn, delegation, child result, usage record, and board handoff
is durable, fenced, policy-controlled, visible through the shared task timeline,
and recoverable across service restarts.

## Relationship to Phase 5A

- Phase 5A direct task chat may ship without Phase 5B.
- Phase 5B reuses exact profile pinning, durable task stream, idempotent messages,
  SSE, and the shared conversation UI.
- Phase 5B persistence/runtime work may proceed in parallel only after those shared
  contracts are frozen.
- Orchestration remains disabled by default and direct worker routing is unchanged.

## Review gates before moving to `in-progress/`

- [ ] Approve Phase 5A/5B as separate release lanes
- [ ] Approve first-class `delegations` and `orchestration_turns` ledgers
- [ ] Approve separate child-return and ownership-handoff contracts
- [ ] Approve immutable profile pinning as a prerequisite
- [ ] Approve dedicated least-privilege `--role orchestrator`
- [ ] Approve v1 limits: depth 1, one active child, sequential only
- [ ] Approve attempt/delegation/conversation token and cost attribution
- [ ] Split spec §20 into independently executable task documents

## Delivery workstreams

- [ ] P5B-00 contracts and dependency freeze
- [ ] P5B-01 exact durable profile/session identity
- [ ] P5B-02 turn and delegation persistence
- [ ] P5B-03 typed handoff policy and applier
- [ ] P5B-04 least-privilege orchestrator runtime
- [ ] P5B-05 scoped catalog, dispatch, and finish tools
- [ ] P5B-06 worker return and parent wake-up
- [ ] P5B-07 timeline, SSE, and UX integration
- [ ] P5B-08 usage, budgets, reconciliation, and operations
- [ ] P5B-09 split/live e2e and release gate

Identity note: Phase 5B remains for trusted local/private self-host deployments
until Phase 6 removes client-supplied identity and adds membership/RBAC/CORS/CSRF.

