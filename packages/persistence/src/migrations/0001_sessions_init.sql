CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  actor             TEXT NOT NULL CHECK (actor IN ('orchestrator', 'worker')),
  parent_session_id TEXT REFERENCES sessions(id),
  status            TEXT NOT NULL,
  channel_origin    TEXT,
  agent_spec_id     TEXT NOT NULL,
  opened_at         TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ NOT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS sessions_open_orchestrator
  ON sessions(actor, status, last_activity_at)
  WHERE actor = 'orchestrator' AND status = 'open';

CREATE INDEX IF NOT EXISTS sessions_routing_worker
  ON sessions(actor, status, opened_at)
  WHERE actor = 'worker' AND status = 'routing';

CREATE INDEX IF NOT EXISTS sessions_channel_origin
  ON sessions(channel_origin)
  WHERE channel_origin IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_events (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_index BIGINT NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('input', 'action', 'turn', 'system')),
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, event_index)
);

CREATE OR REPLACE VIEW work_queue AS
  SELECT * FROM sessions
  WHERE actor = 'worker' AND status = 'routing'
  ORDER BY opened_at ASC;
