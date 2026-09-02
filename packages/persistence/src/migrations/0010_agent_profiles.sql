CREATE TABLE IF NOT EXISTS agent_profiles (
  tenant_id   TEXT NOT NULL,
  profile_id  TEXT NOT NULL,
  version     INTEGER NOT NULL,
  document    JSONB NOT NULL,
  soul        TEXT NOT NULL DEFAULT '',
  base_prompt TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, profile_id, version)
);

CREATE INDEX IF NOT EXISTS agent_profiles_latest
  ON agent_profiles (tenant_id, profile_id, version DESC);
