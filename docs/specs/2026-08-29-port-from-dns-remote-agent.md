# Spec — Port `dns-remote-agent` into a generic `remote-sandbox-agents`

Date: 2026-08-29
Status: **ready to execute** — work order for the porting session (Phase 0 of
[the product spec](2026-08-29-generic-open-source-service-spec.md))
Source: a sibling checkout of `dns-remote-agent` (same parent directory)

## 1. Goal

Produce a working, generic **Kanban-board agent loop** in **this** repo that runs
end-to-end on a laptop with **no AWS credentials and no org-specific services**:
Postgres + Docker + one LLM provider key. Keep the session-first core, board, worker
scheduler, sandbox plane (unix-local + Docker), skills platform, handoff loop, and
MR-draft intent capture. Delete everything else.

Scope discipline for this phase:

- **One engine only: the Pi runner** (`pi-agent`, in-container). Codex — the
  App Server adapter, `packages/codex-client`, the worker's Codex lifecycle glue —
  is **dropped**, not "kept if it compiles". The `AgentEngineRegistry` seam stays,
  so a second engine can return later as an adapter + registry entry.
- **The minimum package set that closes the loop** (§2). If a file is not on the
  path task → route → claim → sandbox → Pi run → snapshot → handoff → board, it
  does not get copied in Phase 0.
- **Agent configuration, access layer, chat, examples gallery are later phases** —
  specified in the [generic open-source service spec](2026-08-29-generic-open-source-service-spec.md)
  (§5.1 config API, §5.4 access, §5.5 chat, §5.3 examples). Do not build any of them
  here; do keep the seams they need (profile loader reads a directory; `/api/agents`
  CRUD stays as-is).

This is a **port with deletion**, not a rewrite and not a fork that keeps dead code
behind flags. If a file only exists to serve a dropped feature, do not copy it.

## 2. What to keep vs. drop

### Keep (copy, then de-org-ify)

| Area | Source | Notes |
|---|---|---|
| Contracts | `packages/contracts` | drop MicroVM/Redshift-specific types if any |
| Persistence | `packages/persistence` | all migrations; repos; in-memory testing impls |
| Channels | `packages/channels` | `BoardChannel` + driver |
| Board UI | `packages/web` | rename branding strings |
| Agent engines | `packages/agent-engines` | **Pi only**: adapter + in-container runner bundle + local tools (incl. `handoff`, `read_skill`) + `AgentEngineRegistry`. Codex adapter does not come |
| Worker | `packages/worker` | profile loader, sandbox bridges. Codex lifecycle glue (`codex-engine`, app-server auth/approval handlers) does not come |
| Scheduler | `packages/scheduler` | all four roles; board API; runtime wiring (minus Codex/MicroVM branches) |
| Sandbox | `packages/sandbox` | `UnixLocalSandboxProvider`, `DockerSandboxProvider`, mounts, capabilities, `LocalSnapshotStore`, copy-tree ownership fix |
| Skills | `packages/skills` + `platform-skills/` resolution pipeline | pin-at-route-time, risk-class clamp, `INDEX.md` + `read_skill` |
| Profiles | `packages/worker/assets/agents/{coder,reviewer}` | replace org repo slugs in `scopePolicy.allowedRepos` with the sample repo |
| Compose/Docker | `docker-compose.yml`, `Dockerfile`, `docker-compose.docker-worker.yml` | strip AWS CLI install, AWS env, MicroVM overlay |
| E2E script | `scripts/live-board-coder-reviewer-e2e.sh` | retarget at the local sample repo; add the author leg |
| Handoff + autobounce | `scheduler/wiring/handoff.ts`, `synthesizeFallbackHandoff` | unchanged behaviour |
| MR intent capture | `mrRequest` capture path (sidecar → task) | keep capture + approve/reject **states**; see §4 |

### Drop (do not copy)

| Area | Source | Why |
|---|---|---|
| Codex engine | `packages/codex-client`, `agent-engines` Codex adapter, `worker` Codex lifecycle (`codex-engine`, auth/approval handlers, `DockerProcessLauncher` if Codex-only), `codex-agent` registry entry, `CODEX_*` env | one engine is enough for the generic loop; the registry seam is the way back |
| Lambda MicroVM | `LambdaMicroVmSandboxProvider`, `microvm-aws-cli.ts`, `infra/lambda-microvm/`, MicroVM compose overlay, guest image | cloud-specific |
| S3 snapshot store | s3 store + `REMOTE_AGENT_SNAPSHOT_BUCKET` wiring, snapshot-store policy branches for s3/microvm | local store only |
| Redshift | `platform-skills/redshift`, `REMOTE_AGENT_REDSHIFT_*`, `run.redshift` payload, guest config writer | org data access; re-enters later as a named capability |
| GitLab promotion | `gitlab-promote.ts` (the HTTP client half), GitLab tokens, mirror-clone auth | replaced by git-artifact promotion (§4) |
| DTR profile + skill | `agents/dtr`, `skills/dtr` | H&B trading-specific |
| Org repo catalog | `projects` config entries for `hb/*` | replaced by one bundled sample repo |
| POC role assumption | `infra/poc-assume-role/`, `assumeMicrovmInvokerRole` | AWS-specific |
| Session-handoff history, org reviews/specs | `session-handoff/`, `docs/reviews`, most of `docs/superpowers` | history of the other repo; this repo starts clean |

### The grep gate

After the port, these must return **zero** hits in source (docs may mention them as
non-goals): `microvm`, `lambda`, `redshift`, `AWS_`, `s3://`, `hb/`, `gitlab`,
`codex` (case-insensitive, excluding this spec and ARCHITECTURE.md's seam table).

## 3. Sample repo (replaces the org repo catalog)

Bundle a tiny git repo at `fixtures/sample-service/` (created by a script, or a
checked-in tree that a script `git init`s into `runs/fixtures/`): a small Node or
Python service with a README, one source file, one test, and an intentionally shabby
corner for the coder to improve. The project config registry points at it via a
`local-dir`/`git` mount. No network cloning in the default loop.

## 4. MR draft flow without GitLab

Keep the intent contract, swap the promotion target:

1. Coder writes `.agent/mr-request.json` (title, description, branch) — unchanged.
2. Harness captures it onto the task as `mrRequest: pending_approval` — unchanged.
3. **Approve** produces a *promotion artifact* instead of a GitLab MR: a
   `changes.patch` + `branch.bundle` (from the snapshot's committed diff) attached to
   the task, plus a comment describing how to apply it. Implemented as a
   `PromotionTarget` seam with one shipped impl (`GitArtifactPromotion`); the GitLab
   impl stays behind in the org repo and can be registered later.
4. Reject keeps its current behaviour (comment + state).

## 5. Profiles (three, all `engine: pi-agent`)

| Profile | Runtime | Skills | Capabilities | maxTurns | Hands off to |
|---|---|---|---|---|---|
| `coder` | sandbox-docker | repo-orientation | filesystem, shell, apply_patch, handoff, request_mr | 30 | `agent-reviewer` |
| `reviewer` | sandbox-docker | repo-orientation | filesystem, shell, apply_patch, handoff | 20 | task creator |
| `author` | sandbox-docker | business-paper, chart | filesystem, shell, handoff | 30 | task creator |

`agents/` in this repo holds the profile sources; the port moves them to wherever the
profile loader expects (`packages/worker/assets/agents/`) and keeps `agents/` as the
authoring location if the two must differ — do not maintain two divergent copies.

The `author` profile is the proof that a *non-coding* use case is just profile +
skills: task brief "research topic X and write a short paper" → author reads pinned
skills, writes `artifacts/<topic>.md` (charts per the `chart` skill), hands off. No
repo mount is required for author tasks (workspace-only run); the scheduler must
tolerate a task with zero repos.

## 6. Explicit non-goals (record, do not build)

- **WhatsApp / Slack / email notification** — an outbound `Channel` seam impl, later.
- **Cloud sandbox backends** (Firecracker/MicroVM), cloud snapshot stores — the
  `SandboxProvider` / `SnapshotStore` seams are where they plug in.
- **Named data capabilities** (Redshift-style warehouse access) — future capability
  contract: skill declares, profile grants, harness brokers per backend.
- **Multi-tenancy, OIDC, secret scanning** — inherit the source repo's posture
  (local-dev auth via `REMOTE_AGENT_API_TOKEN`).

## 7. Definition of done

1. `npm run build` and every per-package test suite pass in this repo.
2. The grep gate (§2) passes.
3. `docker compose up` starts postgres + api; the board serves `/app/`.
4. Coder→reviewer e2e passes against the bundled sample repo using
   `sandbox-docker`, driven by `scripts/live-board-e2e.sh`, with only
   `OPENAI_API_KEY` (or Anthropic) set.
5. Author e2e: a task assigned `agent-author` produces a paper in `artifacts/` on the
   snapshot and lands in `review` assigned to the creator.
6. Approving the coder's `mrRequest` attaches `changes.patch` + `branch.bundle` to the
   task.
7. A fresh `.env.example` contains **only** the variables in AGENTS.md §Environment.
8. README/AGENTS/ARCHITECTURE updated to describe what actually shipped.

## 8. Execution plan (run tasks in order; each leaves the tree green; commit per task)

> **For agentic workers:** execute task-by-task with checkbox tracking. Every task
> ends with its verify command passing. Do not start a task before the previous one's
> verify passes. Do not build anything listed in §6 or in the product spec's later
> phases.

### T1 — Copy the keep-list, build green

- [ ] Copy keep-list packages (§2) from the sibling `dns-remote-agent` checkout:
      `contracts`, `persistence`, `channels`, `web`, `agent-engines` (Pi paths only),
      `worker` (minus Codex lifecycle), `scheduler`, `sandbox`, `skills`, plus root
      `package.json` / `tsconfig*` / `scripts` needed by the build.
- [ ] Delete Codex/MicroVM/S3/Redshift/GitLab imports and their call sites (drop
      list §2) rather than stubbing them.
- [ ] Verify: `npm run build && npm run check` green.

### T2 — De-org the runtime surface

- [ ] Strip Compose to `postgres` + `api` (+ optional worker/control profiles);
      Dockerfile loses the AWS CLI install and Codex bits; write `.env.example`
      containing only AGENTS.md §Environment.
- [ ] Verify: `docker compose config` clean; grep gate (§2) passes on `packages/`,
      `docker-compose*`, `Dockerfile`, `.env.example`.

### T3 — Sample repo fixture + profiles

- [ ] Create `fixtures/sample-service/` + init script; point project config at it.
- [ ] Port `coder` + `reviewer` profiles with `scopePolicy.allowedRepos:
      [sample/service]`.
- [ ] Verify: unit tests for profile loading + manifest build pass.

### T4 — Live loop: coder → reviewer

- [ ] Port the e2e script as `scripts/live-board-e2e.sh` (drop GitLab preflight and
      POC-role block; target the fixture repo).
- [ ] Verify: script passes with only `OPENAI_API_KEY` set (Docker runtime).

### T5 — Author profile (zero-repo run)

- [ ] Add `author` profile (skills: business-paper, chart; capabilities: filesystem,
      shell, handoff); make the scheduler tolerate a task with zero repos.
- [ ] Verify: author task produces `artifacts/<topic>.md` on the snapshot; task lands
      in `review` assigned to the creator; add this leg to the e2e script.

### T6 — Git-artifact promotion

- [ ] Implement `PromotionTarget` + `GitArtifactPromotion` (§4); wire approve/reject.
- [ ] Verify: approving an `mrRequest` attaches `changes.patch` + `branch.bundle`.

### T7 — Close out

- [ ] Full grep gate over the whole repo; per-package test suites green.
- [ ] Update README/AGENTS/ARCHITECTURE to describe what actually shipped; check
      the Definition of done (§7) line by line.

## 9. What comes after (do not do here)

The next phases are specified in
[2026-08-29-generic-open-source-service-spec.md](2026-08-29-generic-open-source-service-spec.md):
examples gallery (§5.3), **agent configuration API** (§5.1), snapshot pillar polish
(§5.2), access layer (§5.4), chat + SSE (§5.5), in that phasing order (§6).
