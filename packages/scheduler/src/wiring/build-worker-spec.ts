import type { AgentSpec, PromptSource, SessionSnapshot, ToolProvider } from '@remote-sandbox-agents/contracts';
import type { ResolvedAgentConfig } from '@remote-sandbox-agents/orchestrator';

const EMPTY_TOOLS: ToolProvider = { list: () => [], invoke: async () => ({ success: true, output: '' }) };

/**
 * Build a worker AgentSpec from a resolved profile config, with the workspace provider
 * bound to a pre-materialized sandbox session root.
 *
 * The engine kind comes from the profile (`pi-agent` or `pi-agent`):
 * - The agent reads `spec.workspace.prepare().path` for its cwd and runs in-container.
 * - pi runs host-side and executes its tools against `spec.fs.root`; for a sandbox
 *   run those tools are the sandbox-capability pack passed in as `tools`.
 *
 * The system prompt is soul + base-prompt (worker has no dedicated prompt-builder). AGENTS.md
 * project instructions live in the workspace via the manifest, not the system prompt.
 */
export function buildWorkerSpec(cfg: ResolvedAgentConfig, sessionRoot: string, tools: ToolProvider = EMPTY_TOOLS): AgentSpec {
  const model = cfg.profile.model?.id ?? 'gpt-5';
  const system = `${cfg.soul}\n\n${cfg.basePrompt}`;

  const prompt: PromptSource = {
    async assemble(_session: SessionSnapshot) {
      return { system, cacheBreakpoints: [], hash: '' };
    },
  };

  return {
    id: cfg.id,
    actor: 'worker',
    engine: { kind: cfg.profile.engine ?? 'pi-agent', options: { model } },
    prompt,
    tools,
    skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' } as AgentSpec['skills'],
    workspace: {
      kind: 'local',
      prepare: async () => ({ path: sessionRoot, cleanupHints: { retention: cfg.profile.workspaceRetention ?? 'delete-on-success' }, metadata: {} }),
      cleanup: async () => {},
    } as AgentSpec['workspace'],
    secrets: { resolve: async () => [] } as AgentSpec['secrets'],
    fs: { mode: 'scoped', root: sessionRoot },
    policies: cfg.profile.policies,
    metadata: {},
  };
}
