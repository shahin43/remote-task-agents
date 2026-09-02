-- Per-attempt operational state for worker runs (the "runner agent" view).
--
-- Rationale: sessions + session_events durably record the conversation and
-- the lifecycle event stream, but to answer simple operational questions
-- ("which containers are running right now?", "p95 sandbox startup latency",
-- "failure rate per agent profile this week") you need an indexed first-class
-- row per attempt. This table is that operational projection.
--
-- Lifecycle: one row inserted at attempt start (status='starting'), patched
-- when the sandbox container is created (status='sandbox_ready', sandbox_*
-- columns), and finalized after worker_end (status='succeeded'|'failed',
-- snapshot_ref, summary, duration_ms). session_events stays the audit log;
-- this row is the queryable projection.

CREATE TABLE IF NOT EXISTS agent_runs (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- Optional: board-scoped sessions FK their task here for fast task-level
  -- queries. Non-board sessions (orchestrator dispatch_job, etc.) leave it
  -- NULL. ON DELETE SET NULL keeps history if a task is removed.
  task_id             TEXT REFERENCES board_tasks(id) ON DELETE SET NULL,
  attempt_number      INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN (
    'starting', 'sandbox_ready', 'running', 'snapshotting', 'succeeded', 'failed'
  )),
  agent_spec_id       TEXT NOT NULL,

  -- Where it ran
  backend             TEXT,           -- 'docker' | 'unix-local'
  sandbox_session_id  TEXT,           -- ephemeral container session id
  container_id        TEXT,           -- docker container hash, if any
  workspace_location  TEXT,

  -- When
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sandbox_ready_at    TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  duration_ms         INTEGER,

  -- What it produced
  snapshot_ref        JSONB,          -- { type, id, location }
  summary             TEXT,
  error               TEXT,
  finish_reason       TEXT,
  token_usage         JSONB,
  tools_used          JSONB,          -- string[]

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS agent_runs_session
  ON agent_runs(session_id, attempt_number);

CREATE INDEX IF NOT EXISTS agent_runs_task
  ON agent_runs(task_id, started_at DESC) WHERE task_id IS NOT NULL;

-- Hot path for "what's running right now" without a JSONB scan.
CREATE INDEX IF NOT EXISTS agent_runs_live
  ON agent_runs(status, started_at DESC)
  WHERE status NOT IN ('succeeded', 'failed');

CREATE INDEX IF NOT EXISTS agent_runs_started_at
  ON agent_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_sandbox_session_id
  ON agent_runs(sandbox_session_id) WHERE sandbox_session_id IS NOT NULL;
