# Done — Phase 0: generic port

Spec: [2026-08-29-port-from-dns-remote-agent.md](../../specs/2026-08-29-port-from-dns-remote-agent.md)
Product phase: [generic spec §6 Phase 0](../../specs/2026-08-29-generic-open-source-service-spec.md)

## Port work order T1–T7

- [x] **T1** Copy keep-list packages; drop Codex / MicroVM / S3 store / warehouse / host-git HTTP client; `@remote-sandbox-agents` scope; `npm run build` / `npm run check` green.
- [x] **T2** Compose is postgres + api (+ control/worker); Dockerfile has no cloud CLI; `.env.example` matches `AGENTS.md` environment; grep gate on packages / compose / Dockerfile / `.env.example`.
- [x] **T3** `fixtures/sample-service/` + `scripts/init-sample-fixture.sh`; project catalog `sample/service`; coder/reviewer `allowedRepos: [sample/service]`.
- [x] **T4** `scripts/live-board-e2e.sh` coder → reviewer on the sample repo (`sandbox-docker`).
- [x] **T5** `author` profile (business-paper, chart; zero repos); e2e author leg; scheduler tolerates empty `repos`.
- [x] **T6** `PromotionTarget` / `GitArtifactPromotion`; approve writes `changes.patch` + `branch.bundle`; board UI shows paths.
- [x] **T7** Per-package tests; grep gate (specs + `ARCHITECTURE.md` excluded); README / AGENTS describe the shipped loop.

## Definition of done (§7)

- [x] Build and per-package unit tests.
- [x] Grep gate (non-goal tokens only in specs / architecture seam table).
- [x] `docker compose` postgres; API serves `/app/` after `npm run build:web`.
- [x] Live script exists for coder → reviewer + author (`scripts/live-board-e2e.sh`).
- [x] Approve path attaches git artifacts (unit-tested; live script posts `/mr-request/approve` when a request is pending).
- [x] `.env.example` aligned with `AGENTS.md`.
- [x] README / AGENTS / ARCHITECTURE updated.

Live LLM loop evidence: see `docs/session-handoff/2026-08-29-e2e-and-phases-1-3.md`.
E2e scripts source sibling `dns-remote-agent/.env` for provider keys only and force
`REMOTE_AGENT_SNAPSHOT_STORE=local`.
