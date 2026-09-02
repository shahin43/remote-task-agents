# Later — Phase 7: agent-config UI

Spec §5.1 "UI later" (split out of the old chat+config phase in the 2026-08-29
reorder). Depends on Phase 6 roles: profile/agent writes are `admin` actions.

Exit: create an agent from the UI over the Phase 2 profile API; zero UI-only
behaviour.

## Already shipped (listing only)

The Agents tab is a scannable listing, not the Phase 7 editor:

- [x] Profile templates vs registered agents (two grids)
- [x] Compact registered cards (engine/runtime/model chips; policy; repos/guardrails in `<details>`)
- [x] Existing New agent / Edit / Delete over `/api/agents` + template dropdown from `/api/agent-profiles`

That listing is tracked with the board SPA follow-on:
[done/board-spa-task-view.md](../done/board-spa-task-view.md).

## Checklist (still later)

- [ ] Agents tab create/edit forms over `/api/agent-profiles` + `/api/agents`
- [ ] Validation errors from the API rendered inline (no client-side duplication)
- [ ] Version history view (immutable profile versions from Phase 2)
- [ ] Chat opt-in (`chat: true`) editable per profile
