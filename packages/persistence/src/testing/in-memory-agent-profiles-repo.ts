import type { AgentProfileRow, AgentProfilesRepo } from '../agent-profiles-repo.js';

export class InMemoryAgentProfilesRepo implements AgentProfilesRepo {
  private readonly rows: AgentProfileRow[] = [];

  async getLatest(tenantId: string, profileId: string): Promise<AgentProfileRow | null> {
    const match = this.rows
      .filter((r) => r.tenantId === tenantId && r.profileId === profileId)
      .sort((a, b) => b.version - a.version)[0];
    return match ?? null;
  }

  async listLatest(tenantId: string): Promise<AgentProfileRow[]> {
    const latest = new Map<string, AgentProfileRow>();
    for (const row of this.rows.filter((r) => r.tenantId === tenantId)) {
      const prev = latest.get(row.profileId);
      if (!prev || row.version > prev.version) latest.set(row.profileId, row);
    }
    return [...latest.values()].sort((a, b) => a.profileId.localeCompare(b.profileId));
  }

  async insertVersion(input: Omit<AgentProfileRow, 'createdAt' | 'version'> & { version?: number }): Promise<AgentProfileRow> {
    const latest = await this.getLatest(input.tenantId, input.profileId);
    const version = input.version ?? (latest ? latest.version + 1 : 1);
    const row: AgentProfileRow = {
      tenantId: input.tenantId,
      profileId: input.profileId,
      version,
      document: input.document,
      soul: input.soul,
      basePrompt: input.basePrompt,
      createdAt: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }
}
