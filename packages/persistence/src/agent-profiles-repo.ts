import type { DatabasePool } from './connection.js';

export interface AgentProfileRow {
  tenantId: string;
  profileId: string;
  version: number;
  document: Record<string, unknown>;
  soul: string;
  basePrompt: string;
  createdAt: string;
}

export interface AgentProfilesRepo {
  getLatest(tenantId: string, profileId: string): Promise<AgentProfileRow | null>;
  listLatest(tenantId: string): Promise<AgentProfileRow[]>;
  insertVersion(row: Omit<AgentProfileRow, 'createdAt' | 'version'> & { version?: number }): Promise<AgentProfileRow>;
}

export class PgAgentProfilesRepo implements AgentProfilesRepo {
  constructor(private readonly pool: DatabasePool) {}

  async getLatest(tenantId: string, profileId: string): Promise<AgentProfileRow | null> {
    const { rows } = await this.pool.query<{
      tenant_id: string; profile_id: string; version: number;
      document: Record<string, unknown>; soul: string; base_prompt: string; created_at: Date;
    }>(
      `SELECT tenant_id, profile_id, version, document, soul, base_prompt, created_at
         FROM agent_profiles
        WHERE tenant_id = $1 AND profile_id = $2
        ORDER BY version DESC
        LIMIT 1`,
      [tenantId, profileId],
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  }

  async listLatest(tenantId: string): Promise<AgentProfileRow[]> {
    const { rows } = await this.pool.query<{
      tenant_id: string; profile_id: string; version: number;
      document: Record<string, unknown>; soul: string; base_prompt: string; created_at: Date;
    }>(
      `SELECT DISTINCT ON (profile_id)
              tenant_id, profile_id, version, document, soul, base_prompt, created_at
         FROM agent_profiles
        WHERE tenant_id = $1
        ORDER BY profile_id, version DESC`,
      [tenantId],
    );
    return rows.map(mapRow);
  }

  async insertVersion(input: Omit<AgentProfileRow, 'createdAt' | 'version'> & { version?: number }): Promise<AgentProfileRow> {
    const latest = await this.getLatest(input.tenantId, input.profileId);
    const version = input.version ?? (latest ? latest.version + 1 : 1);
    if (latest && input.version == null && version <= latest.version) {
      throw new Error('agent profile version collision');
    }
    const { rows } = await this.pool.query<{
      tenant_id: string; profile_id: string; version: number;
      document: Record<string, unknown>; soul: string; base_prompt: string; created_at: Date;
    }>(
      `INSERT INTO agent_profiles (tenant_id, profile_id, version, document, soul, base_prompt)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING tenant_id, profile_id, version, document, soul, base_prompt, created_at`,
      [input.tenantId, input.profileId, version, JSON.stringify(input.document), input.soul, input.basePrompt],
    );
    return mapRow(rows[0]!);
  }
}

function mapRow(row: {
  tenant_id: string; profile_id: string; version: number;
  document: Record<string, unknown>; soul: string; base_prompt: string; created_at: Date;
}): AgentProfileRow {
  return {
    tenantId: row.tenant_id,
    profileId: row.profile_id,
    version: row.version,
    document: row.document,
    soul: row.soul,
    basePrompt: row.base_prompt,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}
