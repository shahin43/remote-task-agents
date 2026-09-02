-- Canonical Kanban board schema (system of record for agent work).
-- Kept strictly separate from the Hermes session schema and the legacy
-- remote_agent_* schema. All rows carry tenant_id + project_id (single-tenant
-- enforced for now; columns exist from day one to avoid a tenancy migration).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('human')),
  display_name  TEXT NOT NULL,
  external_refs JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS users_project ON users(project_id);

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  profile_id    TEXT NOT NULL,
  display_name  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_project ON agents(project_id);

CREATE TABLE IF NOT EXISTS board_tasks (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'backlog',
  priority      TEXT NOT NULL DEFAULT 'medium',
  assignee_kind TEXT CHECK (assignee_kind IN ('agent', 'user')),
  assignee_id   TEXT,
  created_by    TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_tasks_project_status ON board_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS board_tasks_assignee ON board_tasks(assignee_id) WHERE assignee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_assignments (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  assignee_kind TEXT NOT NULL CHECK (assignee_kind IN ('agent', 'user')),
  assignee_id   TEXT NOT NULL,
  assigned_by   TEXT NOT NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  unassigned_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS task_assignments_task ON task_assignments(task_id, assigned_at);
-- At most one open assignment per task (the current one).
CREATE UNIQUE INDEX IF NOT EXISTS task_assignments_one_open
  ON task_assignments(task_id) WHERE unassigned_at IS NULL;

CREATE TABLE IF NOT EXISTS task_events (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_events_task ON task_events(task_id, created_at);
