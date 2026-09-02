import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { WorkerProfile, ScopePolicy, WorkerEngineKind } from '@remote-sandbox-agents/contracts';
import type { AgentActor } from '@remote-sandbox-agents/contracts';

const KNOWN_WORKER_ENGINES: readonly WorkerEngineKind[] = ['pi-agent'];

export interface AgentProfileConfig {
  id: string;
  actor: AgentActor;
  // Worker-only fields are optional so the same shape covers orchestrator + worker.
  runtime?: WorkerProfile['runtime'];
  engine?: WorkerProfile['engine'];
  model?: { id: string; provider?: string; sandbox?: WorkerProfile['modelDefaults']['sandbox']; approvalPolicy?: WorkerProfile['modelDefaults']['approvalPolicy']; thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' };
  toolsets?: string[];
  skills?: WorkerProfile['skills'];
  policies: {
    approvalPolicy: 'never' | 'on-request' | 'untrusted';
    maxTurns: number;
    turnTimeoutMs: number;
    maxToolCalls: number;
    maxRuntimeMinutes: number;
  };
  workspaceRetention?: WorkerProfile['workspaceRetention'];
  scopePolicy?: ScopePolicy;
  /** Extra Pi runner tool capabilities (e.g. `request_mr`). */
  capabilities?: string[];
}

export interface AgentSources {
  soul: 'service-default' | 'repo-per-profile' | 'repo-legacy' | 'api';
  basePrompt: 'service-default' | 'repo-per-profile' | 'api';
  profile: 'service-default' | 'repo-per-profile' | 'api';
}

export interface ResolvedAgentConfig {
  id: string;
  soul: string;
  basePrompt: string;
  profile: AgentProfileConfig;
  sources: AgentSources;
}

export interface AgentConfigLoaderOptions {
  serviceDefaultRoot: string;       // e.g. packages/orchestrator/assets
  repoOverrideRoot?: string;        // e.g. /path/to/target/repo
  /** API/DB profiles; win over files for the same id. */
  extraProfiles?: () => Promise<ResolvedAgentConfig[]>;
}

type FileKey = 'SOUL.md' | 'base-prompt.md' | 'profile.yaml';

export class AgentConfigLoader {
  constructor(private readonly opts: AgentConfigLoaderOptions) {}

  async resolve(profileId: string): Promise<ResolvedAgentConfig> {
    const extras = (await this.opts.extraProfiles?.()) ?? [];
    const overlay = extras.find((p) => p.id === profileId);
    if (overlay) return overlay;
    // profile.yaml must come first so we know the actor before applying legacy SOUL fallback.
    const profile = await this.loadProfile(profileId);
    const soul = await this.loadFileWithLegacy('SOUL.md', profileId, profile.profile.actor);
    const basePrompt = await this.loadFile('base-prompt.md', profileId);
    return {
      id: profileId,
      soul: soul.content,
      basePrompt: basePrompt.content,
      profile: profile.profile,
      sources: {
        soul: soul.source,
        basePrompt: basePrompt.source,
        profile: profile.source,
      },
    };
  }

  async list(): Promise<AgentProfileConfig[]> {
    const dir = path.join(this.opts.serviceDefaultRoot, 'agents');
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const byId = new Map<string, AgentProfileConfig>();
    for (const extra of (await this.opts.extraProfiles?.()) ?? []) {
      byId.set(extra.id, extra.profile);
    }
    for (const name of entries) {
      const sub = path.join(dir, name);
      const s = await stat(sub).catch(() => null);
      if (!s?.isDirectory()) continue;
      try {
        const { profile } = await this.loadProfile(name);
        if (!byId.has(profile.id)) byId.set(profile.id, profile);
      } catch {
        // ignore non-profile dirs
      }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private async loadFile(file: 'base-prompt.md', profileId: string): Promise<{ content: string; source: 'service-default' | 'repo-per-profile' }> {
    const repo = this.opts.repoOverrideRoot
      ? path.join(this.opts.repoOverrideRoot, '.remote-agent', 'agents', profileId, file)
      : null;
    if (repo) {
      const text = await tryRead(repo);
      if (text !== null) return { content: text, source: 'repo-per-profile' };
    }
    const def = path.join(this.opts.serviceDefaultRoot, 'agents', profileId, file);
    const text = await tryRead(def);
    if (text === null) throw new Error(`agent config missing: ${profileId}/${file}`);
    return { content: text, source: 'service-default' };
  }

  private async loadFileWithLegacy(
    file: 'SOUL.md',
    profileId: string,
    actor: AgentActor,
  ): Promise<{ content: string; source: AgentSources['soul'] }> {
    if (this.opts.repoOverrideRoot) {
      const perProfile = path.join(this.opts.repoOverrideRoot, '.remote-agent', 'agents', profileId, file);
      const t1 = await tryRead(perProfile);
      if (t1 !== null) return { content: t1, source: 'repo-per-profile' };
      if (actor === 'worker') {
        const legacy = path.join(this.opts.repoOverrideRoot, '.remote-agent', file);
        const t2 = await tryRead(legacy);
        if (t2 !== null) return { content: t2, source: 'repo-legacy' };
      }
    }
    const def = path.join(this.opts.serviceDefaultRoot, 'agents', profileId, file);
    const text = await tryRead(def);
    if (text === null) throw new Error(`agent config missing: ${profileId}/${file}`);
    return { content: text, source: 'service-default' };
  }

  private async loadProfile(profileId: string): Promise<{ profile: AgentProfileConfig; source: AgentSources['profile'] }> {
    const repoPath = this.opts.repoOverrideRoot
      ? path.join(this.opts.repoOverrideRoot, '.remote-agent', 'agents', profileId, 'profile.yaml')
      : null;
    if (repoPath) {
      const text = await tryRead(repoPath);
      if (text !== null) return { profile: parseProfile(text, profileId), source: 'repo-per-profile' };
    }
    const def = path.join(this.opts.serviceDefaultRoot, 'agents', profileId, 'profile.yaml');
    const text = await tryRead(def);
    if (text === null) throw new Error(`agent profile missing: ${profileId}/profile.yaml`);
    return { profile: parseProfile(text, profileId), source: 'service-default' };
  }
}

async function tryRead(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function parseProfile(text: string, expectedId: string): AgentProfileConfig {
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`profile.yaml for ${expectedId}: not an object`);
  }
  const p = parsed as AgentProfileConfig;
  if (p.id !== expectedId) {
    throw new Error(`profile.yaml for ${expectedId}: id mismatch (file says '${p.id}')`);
  }
  if (p.actor !== 'orchestrator' && p.actor !== 'worker') {
    throw new Error(`profile.yaml for ${expectedId}: actor must be 'orchestrator' or 'worker'`);
  }
  if (!p.policies) {
    throw new Error(`profile.yaml for ${expectedId}: missing 'policies' block`);
  }
  return p;
}

// Helper for callers that need the legacy WorkerProfile shape.
export function toWorkerProfile(cfg: AgentProfileConfig): WorkerProfile {
  if (cfg.actor !== 'worker') {
    throw new Error(`agent '${cfg.id}' is not a worker (actor=${cfg.actor})`);
  }
  if (!cfg.runtime || !cfg.engine || !cfg.model || !cfg.toolsets || !cfg.skills || !cfg.workspaceRetention) {
    throw new Error(`agent '${cfg.id}' missing worker fields`);
  }
  if (!KNOWN_WORKER_ENGINES.includes(cfg.engine as WorkerEngineKind)) {
    throw new Error(`agent '${cfg.id}' has unknown worker engine '${cfg.engine}'`);
  }
  return {
    id: cfg.id,
    runtime: cfg.runtime,
    engine: cfg.engine,
    modelDefaults: {
      model: cfg.model.id,
      sandbox: cfg.model.sandbox ?? 'workspace-write',
      approvalPolicy: cfg.model.approvalPolicy ?? 'never',
    },
    toolsets: cfg.toolsets,
    skills: cfg.skills,
    approvalPolicy: cfg.policies.approvalPolicy,
    limits: {
      maxRuntimeMinutes: cfg.policies.maxRuntimeMinutes,
      maxToolCalls: cfg.policies.maxToolCalls,
    },
    workspaceRetention: cfg.workspaceRetention,
    scopePolicy: cfg.scopePolicy,
    capabilities: cfg.capabilities,
  };
}
