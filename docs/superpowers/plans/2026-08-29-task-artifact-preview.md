# Task Artifact Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a human opens a completed task, they see the agent's declared deliverables as a rendered preview — not the whole sandbox workspace — and the live e2e gate asserts those previews over the API.

**Architecture:** Same sidecar + harness-applier pattern as `handoff.json`. The model writes `.agent/artifacts.json`; `collect()` reads it as `unknown`; `resolveArtifacts()` validates paths against `artifacts/` in the workspace, then `AgentRunsRepo.finalize()` persists the list on `agent_runs.artifacts`. `GET /api/tasks/:id/artifacts` aggregates across attempts (latest path wins). The task drawer lands on that list. Whole-workspace Files tab stays, demoted.

**Tech Stack:** TypeScript strict (node:test + `npm run test:<pkg>`), Postgres JSONB via `packages/persistence`, React board SPA in `packages/web` (no new npm dependencies — markdown renderer is a small local helper).

**Spec:** [docs/specs/2026-08-29-task-artifact-preview.md](../../specs/2026-08-29-task-artifact-preview.md)

## Global Constraints

- TypeScript strict; parameterized SQL only, in `packages/persistence`.
- Run observability goes through `AgentRunsRepo` — never `sessions.metadata` JSONB hacks.
- No new capability/tool in this phase (`publish_artifact` is explicitly out). Profiles instruct the write.
- No role enforcement (Phase 6). Shape the scoped endpoint only.
- No syntax highlighting, no diff viewer, no HTML-artifact iframe.
- Default cap: `REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES=32` (env, documented in `.env.example`).
- Preview byte cap already exists (`PREVIEW_MAX_BYTES = 2 MiB` in `board-snapshots/service.ts`) — reuse it; do not add a second preview-size env.
- Path rule: every `path` must normalize (use `normalizeSnapshotPath` from `@remote-sandbox-agents/sandbox`) to a file under `artifacts/` (not the `artifacts` directory itself, not a trailing slash, no `..`).
- Invalid declared entries are **dropped with a task comment**, never silently, never by throwing (mirrors handoff: bad JSON does not fail the run).
- If `.agent/artifacts.json` is **absent or not an object**, derive from workspace `artifacts/**` files with `declared: false`. If the sidecar **is present**, keep only valid declared entries — do **not** also derive undeclared siblings (that would preview scratch files).
- At most one `primary: true`; first wins, later primaries coerced to false.
- Edit profile content in `agents/<id>/` only. `packages/worker/assets` is a build copy (`npm run build:assets`).
- **Git:** this repo currently has **no commits**. Do **not** `git add -A`, do **not** create the initial commit, do **not** run `git commit` unless the human has already created a baseline commit. Skip every "Commit" step in this plan until then.
- Tests: `node:test` + `assert/strict`, matching neighboring files. Run the package test script named in each task.

## File map

| File | Role |
|---|---|
| `packages/scheduler/src/wiring/artifacts.ts` | Parse + validate + derive. Pure. |
| `packages/scheduler/src/wiring/artifacts.test.ts` | Unit tests for the resolver. |
| `packages/persistence/src/migrations/0011_agent_runs_artifacts.sql` | JSONB column. |
| `packages/persistence/src/agent-runs-repo.ts` | `artifacts` on record + finalize. |
| `packages/persistence/src/testing/in-memory-agent-runs-repo.ts` | Mirror the column. |
| `packages/agent-engines/src/pi/runner-protocol.ts` | `RUNNER_PATHS.artifactsManifest`. |
| `packages/scheduler/src/wiring/agent-runtime-template.ts` | `collect()` reads the sidecar. |
| `packages/contracts/src/agent/engine.ts` | `AgentTurnResult.artifacts?`. |
| `packages/scheduler/src/wiring/worker-scheduler.ts` | Resolve + pass into `finalize` + completion hook. |
| `packages/scheduler/src/wiring/handoff.ts` | Comment + `handoffContext.artifacts`. |
| `packages/scheduler/src/runtime/completion-projector.ts` | Thread artifacts through applyHandoff. |
| `packages/scheduler/src/api/board-api.ts` | `GET /api/tasks/:id/artifacts`. |
| `packages/web/src/api/{types,client}.ts` + `task-drawer.tsx` | Landing tab + hide repo groups. |
| `packages/web/src/lib/markdown-preview.ts` | Sanitized markdown HTML. |
| `agents/author/AGENTS.md`, `agents/coder/AGENTS.md` | Instruct the sidecar. |
| `.env.example`, `scripts/live-board-e2e.sh` | Cap + e2e assertions. |

---

### Task 1: Artifact resolver (pure)

**Files:**
- Create: `packages/scheduler/src/wiring/artifacts.ts`
- Create: `packages/scheduler/src/wiring/artifacts.test.ts`

**Interfaces:**
- Consumes: `normalizeSnapshotPath` from `@remote-sandbox-agents/sandbox`
- Produces:

```ts
export interface CapturedArtifact {
  path: string;
  title: string;
  primary: boolean;
  declared: boolean;
}

export interface ArtifactDrop {
  path: string;
  reason: 'not_under_artifacts' | 'missing' | 'cap' | 'malformed';
}

export interface ResolveArtifactsResult {
  kept: CapturedArtifact[];
  dropped: ArtifactDrop[];
  /** true when we invented the list from snapshotPaths because no sidecar object was present */
  derived: boolean;
}

export function readArtifactsMaxEntries(env?: NodeJS.ProcessEnv): number;
export function resolveArtifacts(input: {
  declared: unknown;
  snapshotPaths: string[];
  maxEntries?: number;
}): ResolveArtifactsResult;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/scheduler/src/wiring/artifacts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readArtifactsMaxEntries, resolveArtifacts } from './artifacts.js';

const snap = [
  'artifacts/paper.md',
  'artifacts/chart.svg',
  'artifacts/scratch.txt',
  'repo/src/index.ts',
  '.agent/handoff.json',
];

test('absent sidecar derives artifacts/** files, declared false', () => {
  const out = resolveArtifacts({ declared: undefined, snapshotPaths: snap });
  assert.equal(out.derived, true);
  assert.deepEqual(out.kept.map((a) => a.path), [
    'artifacts/chart.svg',
    'artifacts/paper.md',
    'artifacts/scratch.txt',
  ]);
  assert.ok(out.kept.every((a) => a.declared === false));
  assert.equal(out.kept.filter((a) => a.primary).length, 1);
  assert.equal(out.kept.find((a) => a.path === 'artifacts/paper.md')?.primary, true);
});

test('declared sidecar keeps only listed valid paths; does not derive siblings', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/paper.md', title: 'Paper', primary: true },
        { path: 'artifacts/chart.svg', title: 'Chart' },
      ],
    },
    snapshotPaths: snap,
  });
  assert.equal(out.derived, false);
  assert.equal(out.kept.length, 2);
  assert.ok(!out.kept.some((a) => a.path === 'artifacts/scratch.txt'));
  assert.equal(out.kept[0]?.primary, true);
});

test('drops traversal, non-artifacts, missing, and directory paths with a reason', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/../repo/secret' },
        { path: 'repo/src/index.ts' },
        { path: 'artifacts/nope.md' },
        { path: 'artifacts/' },
        { path: 12 },
      ],
    },
    snapshotPaths: snap,
  });
  assert.equal(out.kept.length, 0);
  assert.ok(out.dropped.some((d) => d.reason === 'not_under_artifacts'));
  assert.ok(out.dropped.some((d) => d.reason === 'missing'));
  assert.ok(out.dropped.some((d) => d.reason === 'malformed'));
});

test('empty declared array keeps nothing (does not derive)', () => {
  const out = resolveArtifacts({ declared: { artifacts: [] }, snapshotPaths: snap });
  assert.equal(out.derived, false);
  assert.equal(out.kept.length, 0);
});

test('malformed sidecar (not object) derives', () => {
  const out = resolveArtifacts({ declared: 'nope', snapshotPaths: snap });
  assert.equal(out.derived, true);
  assert.ok(out.kept.length > 0);
});

test('caps extra entries', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/paper.md' },
        { path: 'artifacts/chart.svg' },
        { path: 'artifacts/scratch.txt' },
      ],
    },
    snapshotPaths: snap,
    maxEntries: 2,
  });
  assert.equal(out.kept.length, 2);
  assert.ok(out.dropped.some((d) => d.reason === 'cap'));
});

test('second primary is coerced false', () => {
  const out = resolveArtifacts({
    declared: {
      artifacts: [
        { path: 'artifacts/paper.md', primary: true },
        { path: 'artifacts/chart.svg', primary: true },
      ],
    },
    snapshotPaths: snap,
  });
  assert.equal(out.kept.filter((a) => a.primary).length, 1);
  assert.equal(out.kept[0]?.primary, true);
  assert.equal(out.kept[1]?.primary, false);
});

test('readArtifactsMaxEntries defaults to 32 and parses env', () => {
  assert.equal(readArtifactsMaxEntries({}), 32);
  assert.equal(readArtifactsMaxEntries({ REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES: '8' }), 8);
  assert.equal(readArtifactsMaxEntries({ REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES: 'nope' }), 32);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsc -b packages/scheduler --pretty false && node --test packages/scheduler/dist/wiring/artifacts.test.js`

Expected: FAIL (module missing) or tsc error on missing `./artifacts.js`.

- [ ] **Step 3: Write the implementation**

`packages/scheduler/src/wiring/artifacts.ts`:

```ts
import { normalizeSnapshotPath } from '@remote-sandbox-agents/sandbox';

export interface CapturedArtifact {
  path: string;
  title: string;
  primary: boolean;
  declared: boolean;
}

export interface ArtifactDrop {
  path: string;
  reason: 'not_under_artifacts' | 'missing' | 'cap' | 'malformed';
}

export interface ResolveArtifactsResult {
  kept: CapturedArtifact[];
  dropped: ArtifactDrop[];
  derived: boolean;
}

const DEFAULT_MAX = 32;
const TITLE_MAX = 200;

export function readArtifactsMaxEntries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES;
  if (!raw) return DEFAULT_MAX;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX;
  return n;
}

function isArtifactFilePath(normalized: string): boolean {
  return normalized.startsWith('artifacts/') && !normalized.endsWith('/') && normalized !== 'artifacts';
}

function titleFrom(raw: unknown, path: string): string {
  if (typeof raw === 'string') {
    const t = raw.trim().slice(0, TITLE_MAX);
    if (t.length > 0) return t;
  }
  const base = path.split('/').pop() ?? path;
  return base;
}

function snapshotArtifactFiles(snapshotPaths: string[]): string[] {
  const out: string[] = [];
  for (const raw of snapshotPaths) {
    try {
      const n = normalizeSnapshotPath(raw);
      if (isArtifactFilePath(n)) out.push(n);
    } catch {
      /* skip */
    }
  }
  return [...new Set(out)].sort();
}

function derive(snapshotPaths: string[], maxEntries: number): ResolveArtifactsResult {
  const files = snapshotArtifactFiles(snapshotPaths);
  const dropped: ArtifactDrop[] = [];
  const sliced = files.slice(0, maxEntries);
  for (const path of files.slice(maxEntries)) dropped.push({ path, reason: 'cap' });
  const md = sliced.find((p) => p.endsWith('.md'));
  const primaryPath = md ?? sliced[0];
  const kept: CapturedArtifact[] = sliced.map((path) => ({
    path,
    title: titleFrom(undefined, path),
    primary: path === primaryPath,
    declared: false,
  }));
  return { kept, dropped, derived: true };
}

export function resolveArtifacts(input: {
  declared: unknown;
  snapshotPaths: string[];
  maxEntries?: number;
}): ResolveArtifactsResult {
  const maxEntries = input.maxEntries ?? DEFAULT_MAX;
  const present =
    input.declared !== null &&
    input.declared !== undefined &&
    typeof input.declared === 'object' &&
    !Array.isArray(input.declared);
  if (!present) return derive(input.snapshotPaths, maxEntries);

  const body = input.declared as { artifacts?: unknown };
  if (!Array.isArray(body.artifacts)) return derive(input.snapshotPaths, maxEntries);

  const existing = new Set(snapshotArtifactFiles(input.snapshotPaths));
  const kept: CapturedArtifact[] = [];
  const dropped: ArtifactDrop[] = [];
  let primaryAssigned = false;

  for (const item of body.artifacts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dropped.push({ path: '', reason: 'malformed' });
      continue;
    }
    const rec = item as { path?: unknown; title?: unknown; primary?: unknown };
    if (typeof rec.path !== 'string') {
      dropped.push({ path: String(rec.path ?? ''), reason: 'malformed' });
      continue;
    }
    let normalized: string;
    try {
      normalized = normalizeSnapshotPath(rec.path);
    } catch {
      dropped.push({ path: rec.path, reason: 'not_under_artifacts' });
      continue;
    }
    if (!isArtifactFilePath(normalized)) {
      dropped.push({ path: rec.path, reason: 'not_under_artifacts' });
      continue;
    }
    if (!existing.has(normalized)) {
      dropped.push({ path: rec.path, reason: 'missing' });
      continue;
    }
    if (kept.length >= maxEntries) {
      dropped.push({ path: normalized, reason: 'cap' });
      continue;
    }
    const wantPrimary = rec.primary === true && !primaryAssigned;
    if (rec.primary === true) primaryAssigned = true;
    kept.push({
      path: normalized,
      title: titleFrom(rec.title, normalized),
      primary: wantPrimary,
      declared: true,
    });
  }

  if (kept.length > 0 && !kept.some((a) => a.primary)) kept[0]!.primary = true;
  return { kept, dropped, derived: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scheduler`

Expected: PASS, including the new `artifacts.test.js` file (already in the glob `packages/scheduler/dist/wiring/*.test.js`).

- [ ] **Step 5: Commit** — skip (no git baseline).

---

### Task 2: Persist `agent_runs.artifacts`

**Files:**
- Create: `packages/persistence/src/migrations/0011_agent_runs_artifacts.sql`
- Modify: `packages/persistence/src/agent-runs-repo.ts` (`AgentRunRecord`, `FinalizeAgentRunInput`, `RawRow`, `rowToRecord`, `finalize` SQL)
- Modify: `packages/persistence/src/testing/in-memory-agent-runs-repo.ts` (start row `artifacts: null`; finalize copies `input.artifacts`)
- Modify: `packages/persistence/src/agent-runs-repo.test.ts`

**Interfaces:**
- Consumes: `CapturedArtifact` shape as JSON (do **not** import scheduler from persistence). Duplicate a structural type in the repo file:

```ts
export interface AgentRunArtifact {
  path: string;
  title: string;
  primary: boolean;
  declared: boolean;
}
```

- Produces: `AgentRunRecord.artifacts: AgentRunArtifact[] | null` and `FinalizeAgentRunInput.artifacts?: AgentRunArtifact[] | null`

- [ ] **Step 1: Write the failing test**

Append to `packages/persistence/src/agent-runs-repo.test.ts`:

```ts
test('AgentRunsRepo: finalize stores artifacts JSON', async () => {
  const repo = new InMemoryAgentRunsRepo();
  await repo.start({ id: 'run-art', sessionId: 's', taskId: 't', attemptNumber: 1, agentSpecId: 'author' });
  await repo.finalize({
    id: 'run-art',
    status: 'succeeded',
    endedAt: '2026-08-29T00:00:00.000Z',
    durationMs: 10,
    artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true }],
  });
  const row = await repo.findById('run-art');
  assert.equal(row?.artifacts?.[0]?.path, 'artifacts/paper.md');
  assert.equal(row?.artifacts?.[0]?.declared, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:persistence`

Expected: FAIL (property `artifacts` missing / always null).

- [ ] **Step 3: Implement**

`0011_agent_runs_artifacts.sql`:

```sql
-- Declared or derived deliverable list for an attempt (path, title, primary, declared).

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS artifacts JSONB;
```

In `agent-runs-repo.ts`:
- Add `AgentRunArtifact` interface and `artifacts: AgentRunArtifact[] | null` on `AgentRunRecord` and `RawRow`.
- Add `artifacts?: AgentRunArtifact[] | null` on `FinalizeAgentRunInput`.
- `rowToRecord`: `artifacts: Array.isArray(row.artifacts) ? row.artifacts : null`.
- `finalize` SQL: add `artifacts=$12::jsonb` with `input.artifacts ? JSON.stringify(input.artifacts) : null` (shift if you append after skills_used; keep skills_used as $11, artifacts as $12).
- In-memory `start`: `artifacts: null`. In-memory `finalize`: `artifacts: input.artifacts ?? null`.

- [ ] **Step 4: Run tests**

Run: `npm run test:persistence`

Expected: PASS.

- [ ] **Step 5: Commit** — skip.

---

### Task 3: Collect sidecar and persist on finalize

**Files:**
- Modify: `packages/agent-engines/src/pi/runner-protocol.ts` — add `artifactsManifest: '.agent/artifacts.json'` to `RUNNER_PATHS`
- Modify: `packages/scheduler/src/wiring/agent-runtime-template.ts` — `RuntimeCollectResult.artifacts?: unknown`; `collect()` reads `RUNNER_PATHS.artifactsManifest` the same way as handoff (JSON.parse, malformed → `{ __invalidJson: true, raw }`)
- Modify: `packages/contracts/src/agent/engine.ts` — `AgentTurnResult.artifacts?: unknown`
- Modify: `packages/scheduler/src/wiring/worker-scheduler.ts` — after collect, list artifact file paths from the sandbox; `resolveArtifacts`; pass `artifacts: resolved.kept` into `finalize` and `onWorkerComplete`
- Modify: `packages/scheduler/src/wiring/worker-runtime.ts` if its `onWorkerComplete` result type lists `handoff`/`mrRequest` — add `artifacts?: unknown` on the hook payload **and** pass through `dropped` so Task 4 can comment. Prefer putting `artifacts` (kept) + `artifactDrops` on the completion payload:

```ts
artifacts?: CapturedArtifact[];
artifactDrops?: ArtifactDrop[];
```

List workspace artifact paths without a snapshot-store dependency: after `collect()`, walk via `sandboxSession` the same `read`/`list` the template already uses. Add a helper in `artifacts.ts`:

```ts
export async function listWorkspaceArtifactPaths(
  readFile: (rel: string) => Promise<string | undefined>,
  // simpler: accept string[] from the caller
): never;
```

Do **not** add that. Instead add in `worker-scheduler.ts` a local async function `listSandboxArtifactPaths(session: SandboxSession): Promise<string[]>` that:
1. Tries `session.list('artifacts')` if that method exists on the type.
2. Otherwise: after snapshot, if `snapshotRef` is set, the scheduler already has the sandbox; use `session.read` is file-based.

Inspect `SandboxSession` in `packages/sandbox`. Use whatever list/read API already exists (likely `session.read(rel)` and maybe `exec`). If the session has `listFiles`/`list`, use it. If not, after `manager.snapshot(...)` you cannot easily list without the store.

**Ruling if `SandboxSession` has no directory list:** collect artifact paths by reading the snapshot via the manager after `snapshot()` — `SandboxManager` snapshot path already produced `snapshotRef`. Look up `manager` for a `listFiles` or ask the snapshot store. The worker-runtime constructs the snapshot store; if `worker-scheduler` cannot reach it, list from the workspace with:

```ts
async function listSandboxArtifactPaths(session: SandboxSession): Promise<string[]> {
  const out: string[] = [];
  try {
    const listing = await session.exec({ command: 'sh', args: ['-c', 'find artifacts -type f 2>/dev/null'] });
    // parse stdout lines, normalize
  } catch { /* empty */ }
  return out;
}
```

Prefer a typed API over `find`. Check `packages/sandbox/src` for `list`/`readdir`. If `session.read` only reads files, `find` via exec is acceptable.

Resolve **after** collect and **before** destroy, using workspace paths (those files are what the snapshot will contain). Call `resolveArtifacts({ declared: collected.artifacts, snapshotPaths, maxEntries: readArtifactsMaxEntries() })`.

Pass `result.artifacts = collected.artifacts` on the `AgentTurnResult` in the isolated-agent branch (alongside `handoff` / `mrRequest`).

Also thread `artifacts` + `artifactDrops` on `onWorkerComplete` so Task 4 does not re-resolve.

Add `.env.example` line:

```
REMOTE_AGENT_ARTIFACTS_MAX_ENTRIES=32
```

**Tests:** extend `packages/scheduler/src/wiring/agent-runtime-template` if it has tests; otherwise add a focused test next to worker if too heavy. Minimum: a unit test is already in Task 1. For collect(), if there is no existing collect test, add one in `packages/scheduler/src/wiring/` only if a fake `SandboxSession` already exists in tests. If not, skip a collect integration test — Task 1 covers validation; smoke is e2e in Task 8.

- [ ] **Step 1: Inspect `SandboxSession` for list/read and implement collect + finalize wiring as specified**
- [ ] **Step 2: `npm run test:agent-engines` and `npm run test:scheduler` and `npm run test:contracts` (if contracts has tests) + `npm run check`**
- [ ] **Step 3: Commit** — skip.

---

### Task 4: Handoff comment + `handoffContext.artifacts`

**Files:**
- Modify: `packages/scheduler/src/wiring/handoff.ts` — `HandoffContext.artifacts?: CapturedArtifact[]`; `ApplyHandoffOptions.artifacts?: CapturedArtifact[]`; `ApplyHandoffOptions.artifactDrops?: ArtifactDrop[]`
- Modify: `packages/scheduler/src/wiring/handoff.test.ts`
- Modify: `packages/scheduler/src/runtime/completion-projector.ts` — `WorkerCompletionPayload.artifacts?` / `artifactDrops?`; pass them into `applyHandoff`
- Modify: `packages/orchestrator/src/board/assignment-router.ts` only if `readHandoffContext` is strictly typed and will strip unknown fields — keep `artifacts` on the metadata blob; do **not** hydrate them into the next prompt.

Comment rules:
- If `opts.artifacts?.length`, append (or include in the existing handoff comment) markdown links: `- [title](/api/snapshots/<encoded>/file?path=<path>)` using `encodeSnapshotRef` when `opts.snapshotRef` is a `SnapshotRef`; if encoding fails, list backtick paths only.
- If `opts.artifactDrops?.length`, post a **separate** comment: `Dropped invalid artifact declarations: \`path\` (reason), ...` so drops are never silent.
- Do not fail the handoff if comments fail.

- [ ] **Step 1: Failing tests in `handoff.test.ts`**

```ts
test('applyHandoff: comments artifact links and stamps handoffContext.artifacts', async () => {
  // reuse the existing board/task setup pattern from the snapshotRef test around line 491
  // pass artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true }]
  // assert comment text includes 'artifacts/paper.md' or 'Paper'
  // assert after.metadata.handoffContext.artifacts[0].path === 'artifacts/paper.md'
});

test('applyHandoff: dropped artifacts get their own comment', async () => {
  // pass artifactDrops: [{ path: 'repo/x', reason: 'not_under_artifacts' }]
  // assert some comment includes 'Dropped invalid artifact'
});
```

Follow the existing `applyHandoff` test setup (InMemoryBoardStore, seed user/agent/task) — copy the nearest test's arrange block, do not invent a new board API.

- [ ] **Step 2: Run `npx tsc -b packages/scheduler --pretty false && node --test packages/scheduler/dist/wiring/handoff.test.js`** — expect FAIL.
- [ ] **Step 3: Implement + projector pass-through**
- [ ] **Step 4: `npm run test:scheduler`**
- [ ] **Step 5: Commit** — skip.

---

### Task 5: `GET /api/tasks/:id/artifacts`

**Files:**
- Modify: `packages/scheduler/src/api/board-api.ts` — types, `BoardApiService.taskArtifacts`, route next to `/usage`
- Modify: `packages/scheduler/src/api/board-api.test.ts`
- Modify: `packages/web/src/api/types.ts` + `packages/web/src/api/client.ts`

**Interfaces:**
- Produces:

```ts
export interface TaskArtifactView {
  path: string;
  title: string;
  primary: boolean;
  declared: boolean;
  attemptNumber: number;
  snapshotRefEncoded: string | null;
  previewUrl: string;
  downloadUrl: string;
}

export interface TaskArtifactsView {
  taskId: string;
  artifacts: TaskArtifactView[];
}
```

Aggregation: `agentRuns.listForTask(taskId)` ordered by `attemptNumber` ascending (if `startedAt` order differs, sort by `attemptNumber` then `startedAt`). For each run with `artifacts`, for each item, set `byPath.set(item.path, view)`. Result = `[...byPath.values()]`. Primary: after merge, ensure at most one primary (the primary flag from the winning attempt). If none primary, mark the first as primary.

URLs (relative, no host):

```
previewUrl  = `/api/snapshots/${encodeURIComponent(encoded)}/file?path=${encodeURIComponent(path)}`
downloadUrl = `${previewUrl}&download=1`
```

`encoded` from `encodeSnapshotRef(run.snapshotRef as SnapshotRef)` when `snapshotRef` has `type` and `id`. If missing, `snapshotRefEncoded: null`, `previewUrl`/`downloadUrl` empty string — still list the metadata.

404 when task does not exist (same as `taskUsage`). 200 `{ taskId, artifacts: [] }` when the task exists but has no runs/artifacts.

- [ ] **Step 1: Failing test** in `board-api.test.ts`, same arrange as `taskUsage rolls up token_usage`:

```ts
test('taskArtifacts aggregates latest attempt per path', async () => {
  // createTask, two agentRuns.finalize with overlapping paths
  // attempt 1: artifacts/paper.md declared false
  // attempt 2: artifacts/paper.md declared true title Paper, plus artifacts/chart.svg
  const view = await service.taskArtifacts(created.id);
  assert.equal(view!.artifacts.length, 2);
  const paper = view!.artifacts.find((a) => a.path === 'artifacts/paper.md');
  assert.equal(paper?.declared, true);
  assert.equal(paper?.attemptNumber, 2);
  assert.ok(paper?.previewUrl.includes('path=artifacts%2Fpaper.md') || paper?.previewUrl.includes('artifacts/paper.md'));
});
```

- [ ] **Step 2: Run the single test file after tsc — expect FAIL**
- [ ] **Step 3: Implement `taskArtifacts` + route `GET /api/tasks/:id/artifacts` (match before the generic `/api/tasks/:id` handler if one exists — place beside `/usage`)**
- [ ] **Step 4: Add `api.taskArtifacts(taskId)` in the web client and `TaskArtifactsView` in types.ts**
- [ ] **Step 5: `npm run test:scheduler` and `npm -w @remote-sandbox-agents/web run check`**
- [ ] **Step 6: Commit** — skip.

---

### Task 6: Profile instructions

**Files:**
- Modify: `agents/author/AGENTS.md`
- Modify: `agents/coder/AGENTS.md`

**Interfaces:** none. Content only.

- [ ] **Step 1: Author — after the deliverable bullet, add:**

```
3. Before `handoff`, write `.agent/artifacts.json` listing only the deliverables a human should preview (not scratch files):

{
  "artifacts": [
    { "path": "artifacts/<topic>.md", "title": "<human title>", "primary": true }
  ]
}

Paths must be files under `artifacts/` that exist. Charts that belong with the paper go in the same list. Then call `handoff` as below.
```

Renumber the existing handoff item.

- [ ] **Step 2: Coder — after the finish/handoff section, add a short note:**

```
If you wrote user-facing files under `artifacts/` (not `repo/`), also write `.agent/artifacts.json` listing those paths before `handoff`. Coding tasks that only edit `repo/` may omit the sidecar.
```

Do not edit `packages/worker/assets/agents/**`.

- [ ] **Step 3: Commit** — skip.

---

### Task 7: Task drawer — artifacts landing tab

**Files:**
- Modify: `packages/web/src/components/task-drawer.tsx`
- Modify CSS only if an existing class already covers preview blocks (`packages/web` styles — find the current `.preview-panel` / `.drawer-tabs` stylesheet and reuse).

**Behavior:**
- Rename tab `preview` label to `artifacts` (keep the tab id `preview` or rename to `artifacts` consistently).
- Fetch `api.taskArtifacts(task.id)` whenever the drawer is open (poll like usage when `running`).
- If `task.status` is `review` or `done` **and** `artifacts.length > 0`, default `tab` to that artifacts tab (replace the `useEffect(() => setTab("activity"), [task.id])` so it chooses artifacts in that case, else activity).
- Artifacts tab renders **only** `TaskArtifactView` rows from the API (title + `TypedFilePreview` using `snapshotRefEncoded` + `path`). Open the `primary` one expanded; others collapsed (`<details open={primary}>`).
- Do **not** show `.agent/*` or `git/changes.patch` on this tab.
- Files tab: if `task.repos.length === 0`, hide `git` and `repo` groups in `GroupedFileTree` (pass `hideRepoGroups={task.repos.length === 0}`).
- Files and Runs tabs remain.

- [ ] **Step 1: Implement the drawer changes**
- [ ] **Step 2: `npm -w @remote-sandbox-agents/web run check`**
- [ ] **Step 3: Commit** — skip.

No browser verification required if browser tools cannot reach a running board; the e2e gate in Task 8 covers the API. If a board is already running locally, open a completed author task and confirm the landing tab.

---

### Task 8: Sanitized markdown preview + e2e assertions

**Files:**
- Create: `packages/web/src/lib/markdown-preview.ts`
- Create: `packages/web/src/lib/markdown-preview.test.ts`
- Modify: `packages/web/src/components/task-drawer.tsx` — `TextPreview` / `TypedFilePreview`: `.md` uses `renderMarkdownPreview`; relative image `src` that does not start with `http` or `/` is rewritten by the caller to the sibling snapshot file URL (`/api/snapshots/${encoded}/file?path=${encodeURIComponent(sibling)}` where sibling is resolved against the markdown file's directory).
- Modify: `scripts/live-board-e2e.sh` author leg and coder-reviewer git assertion
- Modify: `examples/02-research-paper/run.sh` only if it needs extra asserts beyond delegating to the e2e script (it currently `exec`s the e2e author leg — **put assertions in `live-board-e2e.sh`**)
- Modify: `docs/tasks/in-progress/phase-4-artifact-preview.md` tick boxes as you complete them

**Markdown renderer rules (no new deps):**
- Escape HTML in text (`& < > "`)
- Support: ATX headings `#`–`###`, paragraphs, unordered lists, pipe tables (`| a | b |`), images `![alt](src)`, links `[t](url)` (http/https/`/`/`artifacts/` only; reject `javascript:`)
- Wrap output in a single `<div class="md-preview">`
- Do not execute HTML from the source — strip raw `<tags>` by escaping

- [ ] **Step 1: Tests** in `markdown-preview.test.ts` run with:

`npx tsx --test packages/web/src/lib/markdown-preview.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownPreview } from './markdown-preview.ts';

test('escapes html and renders a heading', () => {
  const html = renderMarkdownPreview('# Hi\n\n<script>x</script>');
  assert.match(html, /<h1>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('rejects javascript: links', () => {
  const html = renderMarkdownPreview('[x](javascript:alert(1))');
  assert.doesNotMatch(html, /javascript:/);
});

test('rewrites relative image src via callback', () => {
  const html = renderMarkdownPreview('![c](chart.svg)', {
    resolveSrc: (src) => src === 'chart.svg' ? '/api/snapshots/x/file?path=artifacts%2Fchart.svg' : src,
  });
  assert.match(html, /artifacts%2Fchart\.svg/);
});
```

Export:

```ts
export function renderMarkdownPreview(
  markdown: string,
  opts?: { resolveSrc?: (src: string) => string },
): string;
```

- [ ] **Step 2: Implement renderer + wire `.md` in `TypedFilePreview`**
- [ ] **Step 3: E2E author leg** — after `wait_task "$AUTHOR_ID" human` in `scripts/live-board-e2e.sh`:

```bash
echo "== author artifacts preview =="
ART_JSON="$(curl -sf "$BASE/api/tasks/$AUTHOR_ID/artifacts")"
echo "$ART_JSON" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const v=JSON.parse(s);
    const arts=v.artifacts||[];
    if(arts.length<1){ console.error("expected >=1 artifact", v); process.exit(1); }
    const declared=arts.filter(a=>a.declared===true);
    if(declared.length<1){ console.error("expected >=1 declared artifact", arts); process.exit(1); }
    for (const a of arts) {
      if(!a.previewUrl){ console.error("missing previewUrl", a); process.exit(1); }
    }
    process.stdout.write(JSON.stringify(arts.map(a=>({path:a.path,declared:a.declared,previewUrl:a.previewUrl})),null,2)+"\n");
    process.stdout.write("PREVIEW_URLS="+arts.map(a=>a.previewUrl).join(",")+"\n");
  });
'
# curl each previewUrl against BASE (previewUrl is a path)
echo "$ART_JSON" | node -e '
  let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
    const v=JSON.parse(s);
    for (const a of v.artifacts) console.log(a.previewUrl);
  });
' | while read -r p; do
  code="$(curl -sS -o /tmp/art-preview -w "%{http_code}" "$BASE$p")"
  ctype="$(curl -sSI "$BASE$p" | awk -F": " "tolower(\$1)==\"content-type\"{print \$2}" | tr -d "\r")"
  if [[ "$code" != "200" ]]; then echo "preview $p -> $code"; exit 1; fi
  echo "preview_ok $p $ctype"
done
```

Fix the header parse if `curl -sSI` is awkward — a single `curl -sS -D - -o /tmp/art-preview "$BASE$p"` and assert `HTTP/* 200` plus `content-type` matching `text/markdown`, `text/plain`, `image/`, or `application/json` is enough. Do not require `text/html`.

Coder-reviewer leg: after the existing git-artifact approve checks, call `GET /api/tasks/$TASK_ID/artifacts` and assert either empty or every entry has `declared === false` (no false declarations). Still assert `git/changes.patch` is reachable via the existing snapshot files API or the current patch-artifact checks — do not drop those.

- [ ] **Step 4: Tick completed boxes in `docs/tasks/in-progress/phase-4-artifact-preview.md`**
- [ ] **Step 5: `npx tsx --test packages/web/src/lib/markdown-preview.test.ts` and `npm -w @remote-sandbox-agents/web run check` and `npm run test:scheduler`**
- [ ] **Step 6: Commit** — skip.
- [ ] **Step 7: Live e2e** — only if Docker + Postgres + a provider key are already available in this environment:

`bash scripts/live-board-e2e.sh`

If they are not, leave the script changes in place and note "e2e not run here" in the task report. Do not fake a pass.

---

## Spec coverage (self-review)

| Spec § | Task |
|---|---|
| 2.1 sidecar shape, path under `artifacts/`, caps, profile instruction (no new tool) | 1, 3, 6 |
| 2.2 parse/validate, fallback derive, `agent_runs.artifacts`, comment + handoffContext | 1, 2, 3, 4 |
| 2.3 `GET /api/tasks/:id/artifacts`, latest-wins, preview/download URLs, zip unchanged | 5 |
| 2.4 landing tab, markdown HTML, hide repo groups, Files/Runs stay | 7, 8 |
| 2.5 e2e author declared + coder no false declarations | 8 |
| 3 exit criteria | 5–8 |
| 4 non-goals (roles, diff viewer, extra retention) | not implemented |

## Placeholder scan

None of TBD / "handle edge cases" / "similar to Task N" remain in the task bodies.
