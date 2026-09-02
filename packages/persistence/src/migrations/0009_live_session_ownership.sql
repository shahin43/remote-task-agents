-- Split-service ownership fence (P0-03 / P0-04).
-- One live session per board conversation; lease owner/generation for
-- fenced sandbox reconciliation.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_live_worker_channel_origin
  ON sessions (channel_origin)
  WHERE channel_origin IS NOT NULL
    AND actor = 'worker'
    AND status NOT IN ('closed', 'succeeded', 'failed', 'cancelled');

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_generation INTEGER;

CREATE INDEX IF NOT EXISTS agent_runs_container_id
  ON agent_runs (container_id)
  WHERE container_id IS NOT NULL;
