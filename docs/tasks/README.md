# Task tracker

**Index of progress:** keep this folder in sync with the table in
[DEVELOPMENT.md](../../DEVELOPMENT.md) (root development guide). How to pick
the next item, and what to check before claiming done:
[docs/README.md](../README.md).

Specs:

- [Product spec](../specs/2026-08-29-generic-open-source-service-spec.md) (§6 phasing)
- [Phase 4 — task artifact preview](../specs/2026-08-29-task-artifact-preview.md)
- [Phase 5 — chat + SSE + project orchestrator](../specs/2026-08-29-chat-orchestration.md)
- [Phase 5B — durable agent coordination and handoffs](../specs/2026-08-31-durable-agent-coordination-and-handoffs.md)
- [Phase 5 architecture review](../reviews/2026-08-30-phase-5-chat-sse-orchestrator-review.md)
- [Phase 0 port spec](../specs/2026-08-29-port-from-dns-remote-agent.md)

| Folder | Meaning |
|---|---|
| [`done/`](done/) | Finished phases, checked off against the spec |
| [`in-progress/`](in-progress/) | Active work (leftover live proofs) |
| [`later/`](later/) | Explicitly deferred (chat, cloud sandboxes, skill upload, …) |

## Current

**Completed:** Phases 0–4, plus the board SPA task-view follow-on (document reader,
Changes filter, 6-column grid, terracotta accent, Agents listing).

**In progress:** leftover live proofs for `examples/03` and `04` only — no
product phase is open.

**Next: Phase 5 — chat + durable SSE + project orchestrator**
([`later/phase-5-chat-and-orchestration.md`](later/phase-5-chat-and-orchestration.md),
draft expanded; architecture decisions must be reviewed before execution). Phase 5B
durable coordination may proceed after or alongside the frozen Phase 5A foundations,
followed by Phase 6 access layer and the rest of Phase 7 (profile editor).

| Phase | Status |
|---|---|
| 0 Port | [done](done/phase-0-generic-port.md) |
| 1 Examples + snapshots | [done](done/phase-1-examples-and-snapshots.md) |
| 2 Agent config API | [done](done/phase-2-agent-config-api.md) |
| 3 Cycle cap + cost | [done](done/phase-3-cycle-cap-and-cost.md) |
| 4 Task artifact preview | [done](done/phase-4-artifact-preview.md) |
| Board SPA (follow-on to 4) | [done](done/board-spa-task-view.md) |
| Live examples 03/04 | [open proofs](in-progress/open-proofs.md) |
| 5 Chat + SSE + project orchestrator | [later — draft for review](later/phase-5-chat-and-orchestration.md) |
| 5B Durable agent coordination + handoffs | [later — companion draft](later/phase-5b-durable-agent-coordination.md) |
| 6 Access layer (OIDC, roles) | [later](later/phase-6-access-layer.md) |
| 7 Agent-config UI | [later](later/phase-7-agent-config-ui.md) (listing shipped; editor not) |
| 8+ Sandbox hosts (Lambda, Modal, Daytona, …) | [later](later/sandbox-provider-extensions.md) |
| 8+ Skill upload, notifications, tenancy | [later](later/phase-8-plus.md) |

Session notes: [`docs/session-handoff/`](../session-handoff/).
Latest: [`2026-08-29-current.md`](../session-handoff/2026-08-29-current.md).
