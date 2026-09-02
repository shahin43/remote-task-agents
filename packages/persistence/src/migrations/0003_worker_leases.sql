-- Worker-claim leases (Hermes review Gap #5, storage half).
-- A worker session is claimed atomically (routing -> running) with a lease;
-- sessions whose lease expires while still `running` are presumed crashed and
-- are failed by the lease sweep in the orchestrator loop.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sessions_running_worker_lease
  ON sessions(actor, status, lease_expires_at)
  WHERE actor = 'worker' AND status = 'running';
