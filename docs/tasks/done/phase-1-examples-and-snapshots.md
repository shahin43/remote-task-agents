# Done — Phase 1: examples gallery + snapshot polish

Spec: product spec §5.2, §5.3, §6 Phase 1.

Exit: `examples/*/run.sh` green against a fresh compose (except `05-new-skill`, deferred).

## Checklist

- [x] Snapshot retention env vars in `.env.example` / `AGENTS.md`
- [x] `examples/01-fix-a-bug` — coder → reviewer (`E2E_LEGS=coder-reviewer`)
- [x] `examples/02-research-paper` — author zero-repo
- [x] `examples/03-follow-up` — continuation script
- [x] `examples/04-custom-agent-api` — curl profile + agent + poll to human (Phase 2)
- [x] Live `scripts/live-board-e2e.sh` (coder-reviewer + author) **PASS** 2026-08-29

Leftover live proofs: [in-progress/open-proofs.md](../in-progress/open-proofs.md)
(`examples/03`, `examples/04`). `05-new-skill` is [later/phase-8+](../later/phase-8-plus.md).
