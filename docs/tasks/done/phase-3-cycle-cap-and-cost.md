# Done — Phase 3: promotion + cycle cap + cost rollup

Spec §5.6 / §6 Phase 3.

Exit: approve → patch artifacts; bounded agent loops; per-task cost visible.

## Checklist

- [x] Git-artifact promotion on `/api/tasks/:id/mr-request/approve` (`changes.patch` + `branch.bundle`) — landed in Phase 0 T6
- [x] Handoff cycle cap (`REMOTE_AGENT_HANDOFF_CYCLE_CAP`, default 6); further agent targets bounce to a human
- [x] Reviewer `NEEDS FIXES` routes to `agent-coder` (prompt + harness rewrite); projector routes on *resolved* target
- [x] `GET /api/tasks/:id/usage` rolls up `agent_runs.token_usage`
- [x] Board drawer shows per-task token/cost totals
