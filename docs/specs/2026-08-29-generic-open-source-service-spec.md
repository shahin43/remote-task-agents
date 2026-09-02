# Spec — Remote Sandbox Agents as a generic, open-sourceable service

Date: 2026-08-29
Status: proposed — product/feature specification for the generic repo
License decision: **Apache-2.0** (patent grant) — `LICENSE` at the repo root
Companions:
- `2026-08-29-port-from-dns-remote-agent.md` — the mechanical extraction (keep/drop, grep gate, sample repo). This spec assumes that port as its Phase 0.
- Source-repo references (read in a sibling `dns-remote-agent` checkout):
  `ARCHITECTURE.md`, `docs/reviews/2026-08-25-production-readiness-backlog.md`,
  `docs/superpowers/specs/2026-08-26-production-saas-hardening-and-service-boundaries.md`,
  `session-handoff/2026-08-26-split-services.md`.

## 1. Vision

**A Kanban board where the assignees are sandboxed AI agents.** A task card is created,
assigned to an agent, and picked up by a worker that runs the agent inside an isolated
sandbox against a real git workspace. The run ends with a snapshot (real diff,
artifacts), a structured summary on the card, and a handoff — to another agent or to a
human. Humans steer through the board and through follow-up conversation; agents never
own routing.

Positioning for open source:

- **Self-hostable with three dependencies:** Node, Postgres, Docker. One provider key
  (OpenAI or Anthropic). No cloud account required for the default experience.
- **The board is the product.** Not a CLI, not a chat app with a task list bolted on —
  a durable, auditable work queue where agent attempts are first-class, replayable
  records.
- **Extend by seam, not by fork.** Sandbox providers, engines, skills, channels,
  promotion targets, and identity are all pluggable interfaces with at least one
  shipped implementation each.

## 2. What carries over unchanged (the proven core)

These are locked decisions inherited from the source project; re-litigating them is
out of scope:

1. **Session-first persistence.** `sessions` + append-only `session_events` (atomic
   per-session counter) + `agent_runs` (one indexed row per attempt) + `task_events`
   (board feed). Three-table division of responsibility.
2. **Two planes, four roles.** `api` (HTTP only) / `control` (sole router) /
   `worker` (execution) / `reconciler` (fenced reaping), plus `api --with-worker`
   for local dev. Split already landed upstream (2026-08-26).
3. **The harness owns side effects.** Handoff, MR intent, comments — captured from
   sidecar files and applied by the harness after the run. Autobounce to a human when
   a succeeded run skips `handoff`.
4. **Skills pinned at route time** with risk-class clamping, `INDEX.md` + `read_skill`
   lazy loading, provenance recorded on `agent_runs`.
5. **Scope clamp before the sandbox exists** (`profile.scopePolicy`).

## 3. Sandbox provider SPI

Shipped in v0.x:

| Provider | Isolation | Purpose |
|---|---|---|
| `sandbox-unix-local` | none (temp dir) | tests, trusted local dev |
| `sandbox-docker` | container; engine runs inside via `docker exec -i` | default |

**The SPI is the contract**, formalized so third parties can add cloud backends
without touching the core:

- `SandboxProvider` — create/exec/write/snapshot/destroy against a `Manifest`.
- A **bundle materializer** per transport (host-staging for docker/unix-local; a
  pack-and-ship path for remote backends) realizing the same declarative
  TaskBundle/workspace layout.
- Provider-declared **capability fulfillment**: when a profile grants a named
  capability (e.g. a data-warehouse credential), each provider documents how the
  harness brokers it (env allowlist, mounted file, secret-path reference). Skills
  declare needs; providers fulfill; the model never sees raw keys.
- Lifecycle **ownership labels + lease generations** so the reconciler can fence and
  reap stranded sandboxes regardless of backend.

**Future scope (documented, not shipped):** Lambda MicroVM (exists upstream and is
the reference remote implementation), Firecracker/Kata self-hosted, Fly Machines,
Cloud Run jobs. The acceptance test for the SPI is that the upstream MicroVM provider
could be re-registered as an out-of-tree plugin with zero core edits.

## 4. Key changes vs. `dns-remote-agent` (what "generic" requires)

1. **De-org everything** — the port spec's keep/drop table and grep gate
   (no `AWS_*`, `microvm`, `redshift`, `hb/*`, GitLab tokens in source).
2. **Promotion becomes a seam.** `PromotionTarget` interface; shipped impl produces
   `changes.patch` + `branch.bundle` artifacts on approve. GitLab/GitHub MR/PR
   adapters are optional plugins, configured per project, never required for e2e.
3. **Repo access becomes explicit project config.** A bundled sample repo fixture for
   the out-of-box loop; user repos added via config with per-repo auth (token env
   reference, ssh agent), all host-side.
4. **Profiles/skills become user-editable content, not baked assets.** `agents/` and
   `platform-skills/` at the repo root are the authoring locations the loader reads
   (dev) or that get baked at image build (deploy). Adding an agent must not require
   a TypeScript change.
5. **Naming/branding sweep** — `remote-sandbox-agents` service name, neutral UI copy,
   Apache-2.0 or MIT license decision, CONTRIBUTING.md, versioned releases.
6. **Single `.env.example` that is the whole configuration surface** — anything not
   in it does not exist.

## 4.5 The three-layer agent model (architect's view)

Everything a user can customize lives in exactly one of three layers. Keeping these
layers distinct is what makes the service generic instead of a pile of features:

```
┌──────────────────────────────────────────────────────────────────┐
│ 3. AGENT PROFILE   who works and under what policy               │
│    identity, engine+model, capabilities, scope clamp, limits,    │
│    handoff target, which skills it pins                          │
├──────────────────────────────────────────────────────────────────┤
│ 2. SKILLS          what the agent knows how to do                │
│    platform skills (shipped, reviewed, for every agent)          │
│    agent-local skills (niche, live beside one profile)           │
│    user/workspace skills (brought by the repo or via API)        │
├──────────────────────────────────────────────────────────────────┤
│ 1. PLATFORM        the invariant machinery                       │
│    board, sessions, routing, sandbox providers, snapshots,       │
│    handoff applier, ledger — never changes per use case          │
└──────────────────────────────────────────────────────────────────┘
```

Rules that keep the layers honest:

- **A new use case must be expressible as layer 2 + 3 only.** If it needs a layer-1
  change, the missing thing is a *seam* (provider, capability, promotion target,
  channel) — add the seam generically, never a use-case special case.
- **Skills are content, profiles are policy.** A skill never grants itself
  capabilities; the profile grants, the resolver clamps (risk-class ≤ granted).
- **Layer sources are ranked by trust:** platform (reviewed, shipped) → agent-local
  (ships with a profile, e.g. a `dtr`-style niche skill upstream) → user/workspace
  (arrives via repo or API; validated, size-capped, secret-scanned, hash-pinned).

## 5. Feature roadmap beyond the port

The pillars in priority order: **agent configuration API** (5.1), **snapshot &
continuity** (5.2), **examples gallery** (5.3), then the access layer (5.4) and chat
(5.5) as the larger future scopes, then loop-completeness items (5.6).

### 5.1 Agent configuration API — bring your own agent (API-first, UI later)

Today profiles are files a developer edits and redeploys. The generic service makes
agents *data*, configurable at runtime — API first, and the board UI later renders
the same API:

- **`/api/agent-profiles` becomes read/write.**
  - `GET /api/agent-profiles` — list (exists upstream, file-backed).
  - `POST /api/agent-profiles` — create a profile: identity, engine kind + model,
    capabilities, scope policy, limits, handoff target, skill selector.
  - `PUT /api/agent-profiles/:id` — new **version**; existing versions are immutable.
    Running sessions keep the version they pinned at route time.
  - `POST /api/agents` — register a board agent bound to a profile version (exists
    upstream as local-dev CRUD; hardened here).
- **Storage:** DB-backed registry (`agent_profiles` table, versioned rows) seeded
  from the `agents/` directory at startup. File profiles remain the authoring path
  for shipped agents; the API is the path for user agents. One loader serves both.
- **Validation at the API boundary, not at run time:** engine kind exists,
  capabilities are known, scope policy parses, skill names resolve, limits within
  server-configured ceilings (max turns/runtime/tool calls a self-hoster sets).
  Reject at POST; a run must never discover a malformed profile.
- **Skill upload (second step):** `POST /api/skills` accepts a skill folder
  (tar/zip): SKILL.md schema check, size cap, path-traversal check, secret scan,
  content-hash pin. Uploaded skills land in the user/workspace trust tier and are
  selectable by user profiles only. Until this lands, user skills arrive via the
  mounted repo's `.remote-agent/skills/` (upstream convention).
- **UI later:** the Agents tab grows create/edit forms over the same endpoints —
  no UI-only behaviour, ever.

Acceptance: with the service running, `curl` a new profile ("changelog-writer",
pi-agent, business-paper skill, handoff to creator), register an agent for it,
assign it a task, and watch it complete — zero deploys, zero file edits.

### 5.2 Snapshot & continuity pillar

Snapshots stop being an implementation detail and become the product's memory. The
contract (inherited, then extended):

- **Every attempt ends in a checkpoint:** workspace tar (committed git tree +
  artifacts + sidecars) persisted by the `SnapshotStore` (local disk in v0.x),
  referenced from `agent_runs.snapshot_ref`.
- **Continuity semantics (exists upstream, made first-class here):** a follow-up
  hydrates the *prior* snapshot into a *fresh* sandbox; conversation replays from
  `session_events`. The pair (workspace checkpoint + event replay) is the whole
  continuation story — chat (5.5) is a view over it.
- **The receiving run always wins:** a restored checkpoint is work product; it can
  never restore or expand identity, capabilities, skills, or credentials (upstream
  invariant, kept verbatim).
- **Snapshot browser** (exists upstream): per-attempt file tree, diff view, artifact
  download (zip). Generic repo keeps it and adds artifact links into task comments.
- **Retention as visible config:** age-based LRU sweep with min-keep-per-task and
  live-attempt protection (exists upstream for local store) — surfaced as three
  documented env vars, not buried.
- **Export/import (nice-to-have, post-v1):** download a checkpoint, re-import it to
  seed a new task — the demo-able "fork this agent's work" move.

### 5.3 Examples gallery — the showcase layer

An `examples/` directory of **runnable scenarios**, each a folder with a README, a
task brief, the profile/skills it uses, and expected artifacts:

| Example | Exercises |
|---|---|
| `01-fix-a-bug` | coder → reviewer → MR draft on the bundled sample repo |
| `02-research-paper` | author + business-paper + chart, zero-repo task, artifacts |
| `03-follow-up` | continuation: review the diff, ask for a change, second attempt |
| `04-custom-agent-api` | create a profile + agent via the API (5.1), run it |
| `05-new-skill` | author an agent-local skill, pin it, watch `read_skill` usage |

Each example ships a `run.sh` that drives the API (create task, assign, poll) so the
gallery doubles as living integration tests and as the onboarding path. The demo
seed (`docker compose up`) creates the board pre-loaded with example 01 ready to
assign.

### 5.4 User access layer (future scope, design now)

Local-dev posture today (shared bearer + client-supplied actor header) is the
top open-source embarrassment; fix order:

1. **Server-side identity resolution.** Sessions/cookies or OIDC; the server derives
   the actor for every write. `x-remote-agent-actor` dies.
2. **Pluggable auth providers:** `local` (username list, dev), `oidc` (any compliant
   IdP — Entra, Google, Keycloak), `token` (CI/service accounts).
3. **Roles:** `viewer` (read board/runs/snapshots), `operator` (create/assign/
   follow-up/approve MR), `admin` (agents/profiles/projects/users). Enforced in the
   API service layer, not the UI.
4. **CORS allowlist + CSRF** for the SPA.
5. **Audit:** every write already lands in `task_events`/`session_events` with an
   actor; the access layer makes that actor trustworthy.

Multi-tenancy (tenant_id enforcement, per-tenant catalogs/quotas) stays **future
scope** — documented so columns and repo interfaces keep carrying `tenantId`, but no
tenant UI/enforcement in v0.x. Tenancy without real identity is decorative (upstream
review conclusion). The agent-configuration API (5.1) must respect roles from day
one: profile/agent writes are `admin` actions even under the `local` provider.

### 5.5 Chat interface with session continuation (future scope, headline UX)

Detailed delivery is split into the shared/direct-chat Phase 5A lane in
[the chat and SSE spec](2026-08-29-chat-orchestration.md) and the optional
[Phase 5B durable coordination companion](2026-08-31-durable-agent-coordination-and-handoffs.md).
Phase 5A may ship without an orchestrator; Phase 5B reuses its pinned-profile,
task-stream, message-command, SSE, and conversation contracts.

Today the follow-up loop exists as an API (`POST /api/tasks/:id/follow-up` reopens
the worker session, hydrates the prior snapshot, replays conversation from
`session_events`). The generic repo turns this into a **first-class chat surface**
built directly on the snapshot & continuity pillar (5.2):

- **Task chat panel** in the board UI: the conversation view of one worker session —
  user turns, assistant summaries, tool-call timeline, snapshot links — rendered from
  `session_events` replay. The same data the engine replays is what the human sees.
- **Continue where it left off:** sending a message on a task in `review`/`done`
  reopens the session (existing `continue` semantics), stamps
  `resumeWorkspace: true` so the prior snapshot hydrates, and the agent resumes with
  full conversational and workspace context. The chat makes the existing
  attempt-chain visible instead of hiding it behind a "Follow-up" button.
- **Live streaming:** `GET /api/events/tasks/:id` (SSE) streams session events as the
  run progresses (status changes, tool calls, assistant text). Board drawer stops
  polling. (Upstream backlog P1.11.)
- **Draft-while-running guard:** input is disabled while the session is `running`
  (existing follow-up rejection), with the SSE stream making that state obvious.
- **Attempt boundaries stay visible.** Chat is a *view over sessions and events*, not
  a new storage model — no schema change beyond what SSE needs. Each attempt remains
  an `agent_runs` row; the chat renders attempt separators with snapshot/diff links.

Acceptance: create a task, let the coder finish, ask "also rename the function" in
the chat, watch the agent resume the same workspace live, and see attempt 2 recorded
with its own snapshot.

### 5.6 Product-loop completeness (adopted from upstream backlog)

| Feature | Source | Note |
|---|---|---|
| Handoff cycle cap | P1.8 | harness limit on agent↔agent bounces; then reviewer `NEEDS FIXES` → coder (P1.9) |
| Usage/cost rollup | P1.13 | `agent_runs.token_usage` → per-task/per-day rollup + optional budget stop |
| Async in-flight drain | P1.14 | worker as bounded launcher; explicitly deferred — replica workers are the interim |
| CI e2e gate | P1.16 | the examples gallery `run.sh` scripts behind a repo secret, nightly |

(Upstream P1.12 "agent profile registry" and P0.5 "snapshot retention" are promoted
to pillars 5.1 and 5.2 above rather than living in this table.)

### 5.7 Channels and notifications (seam only in v0.x)

`Channel` stays the intake/outbound seam with `BoardChannel` as the only shipped
impl. Slack/WhatsApp/email/webhook notifiers ("message me when my paper is ready")
are documented plugin points with a stub example — not shipped features. Inbound
task creation from chat platforms is future scope behind the same seam.

### 5.8 Open-source operational hygiene

- One-command demo: `docker compose up` → seeded board, sample repo, three agents.
- Health/readiness endpoints per role (exists), documented Prometheus-friendly.
- Versioned migrations with a compatibility promise from v1.0.
- Plugin loading convention (out-of-tree providers/promotion targets/auth providers
  register against the composition root) — even if v0.x only supports in-tree
  registration, the registration surface is the documented API.

## 6. Phasing

**Revised 2026-08-29** after the phases 0–3 review (original order: access layer →
chat+config UI → 6+). Phases 0–3 are done and unchanged.

| Phase | Contents | Exit |
|---|---|---|
| 0 | Mechanical port (companion spec) + LICENSE/CONTRIBUTING | e2e coder→reviewer + author on Docker, no cloud creds |
| 1 | Examples gallery (5.3) + snapshot pillar polish (5.2) | all `examples/*/run.sh` green against a fresh compose |
| 2 | Agent configuration API (5.1, profiles + agents; skills upload later) | curl-only custom agent completes a task, zero deploys |
| 3 | Promotion seam + cycle cap + cost rollup (5.6) | approve → patch artifacts; bounded agent loops; per-task cost visible |
| 4 | Task artifact preview + task-view hardening ([spec](2026-08-29-task-artifact-preview.md)) | declared artifacts previewed at task level, not the whole workspace; e2e asserts it |
| 5 | Chat + SSE (5.5) + profile chat orchestration ([spec](2026-08-29-chat-orchestration.md)) | §5.5 acceptance; `POST /api/chats` answered by the default chat profile |
| 5B | Durable parent/child delegation + typed handoffs ([spec](2026-08-31-durable-agent-coordination-and-handoffs.md)) | one bounded child returns exactly once; handoffs remain control-owned; direct chat/worker paths unchanged |
| 6 | Access layer v1 (5.4: server-side actor, local + OIDC, roles, CORS) | no client-supplied identity anywhere |
| 7 | Agent-config UI over the 5.1 API | create an agent from the UI, no UI-only behaviour |
| 8+ | Cloud provider SPI proof, skill upload API, notifications, tenancy | out-of-tree provider registered with zero core edits |

Rationale for the revised order: the artifact view is the surface every completed
task lands on — hardening it end-to-end compounds into chat (artifact links),
access roles (viewer-scoped preview vs. operator workspace browse), and the
examples gallery. Chat precedes identity deliberately: chat v1 ships for trusted
deployments behind one actor-resolution helper that Phase 6 swaps to the
server-derived actor (the original "auth before chat" concern, contained instead
of blocking). Config UI follows identity because profile writes are admin
actions.

## 7. Non-goals (v0.x)

- Lambda MicroVM or any cloud sandbox in-tree (future scope; SPI proof only).
- Multi-tenant enforcement, per-tenant billing.
- A general chat assistant UX — chat exists only as the conversation of a board task.
- Workflow-graph orchestration UI (upstream deferred it too).
- Marketplace/registry hosting for skills; skills ship in-repo.

## 8. Decisions and open questions

Decided:

1. **License: Apache-2.0** (patent grant) — 2026-08-29. `LICENSE` at the repo root.

Open (decide before their phase):

2. Rename `pi-agent` engine label for the public repo, or keep upstream naming for
   easy diff-porting? (Recommend: keep names until v1.0, rename in one sweep.)
3. Does the author profile's zero-repo run need a distinct task type in the UI, or is
   "no repos selected" enough? (Recommend: no new type; hide the diff tab when the
   snapshot has no `repo/`.)
4. SSE vs WebSocket for the chat stream. (Recommend: SSE — one-directional is enough;
   writes stay REST.)
5. Profile version pinning granularity for the config API: pin at route time (like
   skills) vs. latest-at-claim. (Recommend: pin at route time — same invariant
   everywhere.)
