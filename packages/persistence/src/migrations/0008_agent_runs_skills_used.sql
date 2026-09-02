-- Pinned skills used by an attempt (id, version, contentHash, source).

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS skills_used JSONB;
