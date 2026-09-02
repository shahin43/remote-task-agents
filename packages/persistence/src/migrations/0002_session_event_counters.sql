-- Per-session monotonic event-index counter. Appending an event bumps this row via
-- INSERT ... ON CONFLICT DO UPDATE, whose row lock serializes concurrent same-session
-- appends across all pool connections and worker processes — fixing the read-then-insert
-- race on session_events (duplicate (session_id, event_index) primary key).
CREATE TABLE IF NOT EXISTS session_event_counters (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  next_index  BIGINT NOT NULL
);

-- Backfill counters for any session that already has events, so the next append
-- continues from the existing max rather than colliding at index 0.
INSERT INTO session_event_counters (session_id, next_index)
  SELECT session_id, MAX(event_index) + 1 FROM session_events GROUP BY session_id
  ON CONFLICT (session_id) DO NOTHING;
