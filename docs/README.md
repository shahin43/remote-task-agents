# Documentation index

Working index for this repo. Root files stay thin: product intro, how we work,
mental model, and operator conventions. Everything else — specs, task checklists,
research papers, reviews, session notes — lives here.

Project-level files:

| File | Role |
|---|---|
| [README.md](../README.md) | Product intro and local quick start |
| [DEVELOPMENT.md](../DEVELOPMENT.md) | How we work, spec progress table, how processes vs sandboxes run |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Mental model, planes, sandbox SPI, skills |
| [AGENTS.md](../AGENTS.md) | Commands, conventions, environment, e2e definition of working |

## Pick work (agents and checks)

Do not invent a phase. Use this order:

1. Read this page, then the [task tracker](tasks/README.md).
2. Honor [`done/`](tasks/done/) — do not reopen a finished phase unless asked.
3. If [`in-progress/`](tasks/in-progress/) has open items, finish those first
   ([open proofs](tasks/in-progress/open-proofs.md) today: leftover live
   examples `03` and `04` only).
4. Otherwise take the next [`later/`](tasks/later/) item in the tracker table.
   Current next product work is **Phase 5 — chat + durable SSE + project
   orchestrator**
   ([checklist](tasks/later/phase-5-chat-and-orchestration.md),
   [spec](specs/2026-08-29-chat-orchestration.md)). Architecture review
   decisions are still pending; treat that spec as draft-for-review, not an
   implementation work order, until those gates are ticked.
5. Read the matching spec (and any linked review) before coding.
6. When a phase exits, keep [DEVELOPMENT.md](../DEVELOPMENT.md),
   [tasks/README.md](tasks/README.md), and
   [session-handoff](session-handoff/) in sync. If the shipped loop or env
   surface changed, update [AGENTS.md](../AGENTS.md).

**Do not implement** out-of-tree sandbox hosts (Lambda, Modal, Daytona, …) —
SPI only. See [sandbox provider extensions](tasks/later/sandbox-provider-extensions.md).

## Checks before claiming done

- Type-check: `npm run check`
- Package tests: `npm run test:<package>`
- Definition of working: [AGENTS.md](../AGENTS.md) e2e section
- Unattended gate: `bash scripts/live-board-e2e.sh` (Postgres + Docker + one
  provider key)
- After a phase: update the DEVELOPMENT.md progress table, the tracker
  “Current” line, a session-handoff note, and AGENTS.md if the loop or env
  changed

## Specs

| Spec | Role |
|---|---|
| [Generic open-source service](specs/2026-08-29-generic-open-source-service-spec.md) | Product spec; §6 phasing is the roadmap |
| [Task artifact preview](specs/2026-08-29-task-artifact-preview.md) | Phase 4 (shipped) |
| [Chat orchestration](specs/2026-08-29-chat-orchestration.md) | Phase 5A — chat, durable SSE, project orchestrator |
| [Durable agent coordination](specs/2026-08-31-durable-agent-coordination-and-handoffs.md) | Phase 5B — profiles, sessions, delegation, child return, typed handoff |
| [Port from dns-remote-agent](specs/2026-08-29-port-from-dns-remote-agent.md) | Phase 0 keep/drop (historical) |

## Strategy and research

Visual / strategy papers (open in a browser):

1. [Service state and roadmap](service-state-and-roadmap.html) — shipped vs later, hardening map, usage/cost truth
2. [Market research and GTM](market-research-and-gtm-2026.html) — competitive research, positioning, recommended wedge
3. [Brand naming strategy](brand-naming-strategy-2026.html) — launch name, alternatives, collision screen
4. [Hermes agent implementation review](hermes-agent-implementation-review-2026.html) — source-grounded review of Hermes profiles, memory, learning, delegation, Kanban handoff, hosted rooms, sessions

## Reviews, session notes, other reference

| Path | Role |
|---|---|
| [tasks/README.md](tasks/README.md) | Live checklists (`done/` / `in-progress/` / `later/`) |
| [reviews/](reviews/) | Architecture reviews (e.g. [Phase 5 chat/SSE/orchestrator](reviews/2026-08-30-phase-5-chat-sse-orchestrator-review.md)) |
| [session-handoff/](session-handoff/) | Rolling status; latest [2026-08-29-current.md](session-handoff/2026-08-29-current.md) |
| [reference/](reference/) | Scratch notes (e.g. adjacent agent projects) |
| [superpowers/plans/](superpowers/plans/) | Historical implementation plans |
