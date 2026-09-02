# Done — Phase 2: agent configuration API

Spec §5.1 / §6 Phase 2.

Exit: curl-only custom agent completes a task, zero deploys.

## Checklist

- [x] `agent_profiles` table (versioned JSON document + soul + base prompt)
- [x] `POST /api/agent-profiles` create; `PUT /api/agent-profiles/:id` new version
- [x] Loader overlay: API rows win over `agents/` files for the same id
- [x] `POST /api/agents` binds a board principal to a profile id
- [x] Example `examples/04-custom-agent-api/run.sh` (polls until human assignee)

Live curl of example 04: [in-progress/open-proofs.md](../in-progress/open-proofs.md).
Skill upload: [later/phase-8+](../later/phase-8-plus.md).
