import type { AgentProfileConfig, ResolvedAgentConfig } from '@remote-sandbox-agents/orchestrator';
import type { AgentProfileRow, AgentProfilesRepo } from '@remote-sandbox-agents/persistence';

export class ProfileValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

const KNOWN_ENGINES = new Set(['pi-agent']);
const KNOWN_RUNTIMES = new Set(['sandbox-docker', 'sandbox-unix-local', 'local', 'docker']);
const KNOWN_CAPS = new Set(['filesystem', 'shell', 'apply_patch', 'handoff', 'request_mr', 'skills']);
const MAX_TURNS = 80;
const MAX_RUNTIME_MINUTES = 60;
const MAX_TOOL_CALLS = 400;

export interface AgentProfileWriteBody {
  id: string;
  soul?: string;
  basePrompt?: string;
  engine?: string;
  runtime?: string;
  model?: string;
  capabilities?: string[];
  skills?: { mode?: string; names?: string[] };
  scopePolicy?: { allowedRepos?: string[]; allowedMountTypes?: string[] };
  maxTurns?: number;
  maxRuntimeMinutes?: number;
  maxToolCalls?: number;
}

export function validateAndBuildProfileDocument(body: AgentProfileWriteBody): {
  profileId: string;
  document: AgentProfileConfig;
  soul: string;
  basePrompt: string;
} {
  const id = body.id?.trim() ?? '';
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(id)) {
    throw new ProfileValidationError('id must be a lowercase slug (letters, digits, hyphens).');
  }
  const engine = body.engine ?? 'pi-agent';
  if (!KNOWN_ENGINES.has(engine)) throw new ProfileValidationError(`unknown engine: ${engine}`);
  const runtime = body.runtime ?? 'sandbox-docker';
  if (!KNOWN_RUNTIMES.has(runtime)) throw new ProfileValidationError(`unknown runtime: ${runtime}`);
  const caps = body.capabilities ?? ['filesystem', 'shell', 'handoff'];
  for (const cap of caps) {
    if (!KNOWN_CAPS.has(cap)) throw new ProfileValidationError(`unknown capability: ${cap}`);
  }
  const maxTurns = body.maxTurns ?? 30;
  const maxRuntimeMinutes = body.maxRuntimeMinutes ?? 30;
  const maxToolCalls = body.maxToolCalls ?? 200;
  if (maxTurns > MAX_TURNS || maxTurns < 1) throw new ProfileValidationError(`maxTurns must be 1..${MAX_TURNS}`);
  if (maxRuntimeMinutes > MAX_RUNTIME_MINUTES || maxRuntimeMinutes < 1) {
    throw new ProfileValidationError(`maxRuntimeMinutes must be 1..${MAX_RUNTIME_MINUTES}`);
  }
  if (maxToolCalls > MAX_TOOL_CALLS || maxToolCalls < 1) {
    throw new ProfileValidationError(`maxToolCalls must be 1..${MAX_TOOL_CALLS}`);
  }
  const skillNames = body.skills?.names ?? ['business-paper'];
  const document: AgentProfileConfig = {
    id,
    actor: 'worker',
    runtime: runtime as AgentProfileConfig['runtime'],
    engine: engine as AgentProfileConfig['engine'],
    model: { id: body.model ?? 'gpt-5.4-mini', sandbox: 'workspace-write', approvalPolicy: 'never' },
    toolsets: [],
    skills: { mode: 'named', names: skillNames },
    policies: {
      approvalPolicy: 'never',
      maxTurns,
      turnTimeoutMs: 1_800_000,
      maxToolCalls,
      maxRuntimeMinutes,
    },
    workspaceRetention: 'delete-on-success',
    scopePolicy: {
      allowedRepos: body.scopePolicy?.allowedRepos ?? [],
      allowedMountTypes: (body.scopePolicy?.allowedMountTypes ?? ['git']) as Array<'git' | 's3' | 'local-dir'>,
    },
    capabilities: caps,
  };
  const soul = (body.soul ?? `# ${id}\n\nYou complete the assigned board task and hand off to the task creator.\n`).trim();
  const basePrompt = (body.basePrompt ?? `Follow the pinned skills. End with exactly one handoff to a human.\n`).trim();
  if (!soul) throw new ProfileValidationError('soul must not be empty.');
  if (!basePrompt) throw new ProfileValidationError('basePrompt must not be empty.');
  return { profileId: id, document, soul, basePrompt };
}

export function extraProfilesLoader(repo: AgentProfilesRepo, tenantId: string): () => Promise<ResolvedAgentConfig[]> {
  return async () => (await repo.listLatest(tenantId)).map(rowToResolved);
}

export function rowToResolved(row: AgentProfileRow): ResolvedAgentConfig {
  const profile = row.document as unknown as AgentProfileConfig;
  return {
    id: row.profileId,
    soul: row.soul,
    basePrompt: row.basePrompt,
    profile,
    sources: { soul: 'api', basePrompt: 'api', profile: 'api' },
  };
}
