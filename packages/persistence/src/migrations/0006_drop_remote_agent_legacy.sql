-- 2026-06-28: drop the V0 / Linear-oriented `remote_agent_*` schema.
--
-- The board path (sessions, session_events, worker_leases, board_tasks +
-- friends, agent_runs) is the only path now. These tables were created at
-- API startup by the now-removed `Store.ensureSchema()`; nothing in the live
-- service reads or writes them anymore.

DROP TABLE IF EXISTS remote_agent_audit_events CASCADE;
DROP TABLE IF EXISTS remote_agent_events CASCADE;
DROP TABLE IF EXISTS remote_agent_runs CASCADE;
DROP TABLE IF EXISTS remote_agent_tasks CASCADE;
DROP TABLE IF EXISTS remote_agent_workers CASCADE;
DROP TABLE IF EXISTS remote_agent_control_state CASCADE;
