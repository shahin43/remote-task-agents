-- Guest image identity for Docker/remote guest attempts (digest + OCI labels).
-- Unix-local runs leave this NULL.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS guest_image JSONB;
