-- Declared or derived deliverable list for an attempt (path, title, primary, declared).

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS artifacts JSONB;
