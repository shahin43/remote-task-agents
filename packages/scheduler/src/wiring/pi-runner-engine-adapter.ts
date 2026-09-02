import type { AgentEngine, AgentEngineInput, AgentTurnResult, SessionRecord } from '@remote-sandbox-agents/contracts';
import { buildSessionContext, type RunnerSpec, type RunnerScope } from '@remote-sandbox-agents/agent-engines';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';
import { renderSkillsPromptSection } from '@remote-sandbox-agents/skills';
import type { AgentRuntimeTemplate } from './agent-runtime-template.js';

export interface PiRunnerEngineAdapterOptions {
  sandboxSession: SandboxSession;
  template: AgentRuntimeTemplate;
  /** Host path to the runner bundle the template materializes. */
  bundlePath: string;
  provider: string;
  model: string;
  /** Allowlisted env (pi provider key + model config) forwarded to the exec. */
  env: Record<string, string>;
  storeRequests?: boolean;
}

const DEFAULT_CAPABILITIES = ['filesystem', 'shell', 'apply_patch', 'handoff'];

/**
 * Derive the post-clamp scope handed to the in-container runner. Prefers the
 * effective scope stamped on the session metadata (set by the dispatch-time
 * scope-clamp / board path); falls back to a permissive in-repo scope for
 * single-tenant dev where no clamp has run yet.
 */
function scopeFromSession(session: SessionRecord): RunnerScope {
  const meta = session.metadata as Record<string, unknown>;
  const eff = meta.effectiveScope as { targetPaths?: string[]; capabilities?: string[]; skills?: string[] } | undefined;
  return {
    targetPaths: eff?.targetPaths ?? ['.'],
    capabilities: eff?.capabilities ?? DEFAULT_CAPABILITIES,
    skills: eff?.skills ?? [],
  };
}

/**
 * Model B for pi: runs the pi worker agent FULLY INSIDE the sandbox container
 * via a one-shot `pi-runner` entrypoint (mirrors how the host engine runs
 * in-container). It materializes the workspace, execs the runner, and collects
 * the artifacts/events back into an AgentTurnResult — the WorkerScheduler stays
 * unaware of the runtime mechanics.
 */
export class PiRunnerEngineAdapter implements AgentEngine {
  readonly kind = 'pi-agent';
  constructor(private readonly opts: PiRunnerEngineAdapterOptions) {}

  async runTurn(input: AgentEngineInput): Promise<AgentTurnResult> {
    const ctx = buildSessionContext(input.session.history, { includeToolResults: false });
    if (!ctx.currentInput) {
      return { toolCalls: [], finishReason: 'completed' };
    }

    const assembled = (await input.spec.prompt.assemble(input.session)).system;
    const scope = scopeFromSession(input.session.session);
    const skillsSection = renderSkillsPromptSection(scope.skills.map((id) => ({ id })));
    const systemPrompt = skillsSection ? `${assembled}\n\n${skillsSection}` : assembled;
    const spec: RunnerSpec = {
      profileId: input.spec.id,
      provider: this.opts.provider,
      model: this.opts.model,
      maxTurns: input.spec.policies.maxTurns ?? 5,
      systemPrompt,
      input: ctx.currentInput,
      messages: ctx.messages,
      storeRequests: this.opts.storeRequests,
    };

    process.stderr.write(
      `pi-runner.capabilities session=${input.session.session.id} caps=${scope.capabilities.join(',')}\n`,
    );

    await this.opts.template.materialize(this.opts.sandboxSession, { spec, scope, bundlePath: this.opts.bundlePath });

    const { command, args } = this.opts.template.launch(this.opts.sandboxSession);
    let exitCode: number | null = null;
    let execError: string | undefined;
    try {
      const exec = await this.opts.sandboxSession.exec([command, ...args], {
        shell: false,
        env: this.opts.env,
        timeoutMs: (input.spec.policies.turnTimeoutMs ?? 30 * 60_000),
      });
      exitCode = exec.exitCode;
    } catch (err) {
      execError = err instanceof Error ? err.message : String(err);
    }

    const collected = await this.opts.template.collect(this.opts.sandboxSession);

    // Publish each in-container tool call onto the worker session's event stream
    // so the audit log (and a future progress UI) sees what the worker did.
    for (const e of collected.events) {
      const data = e.data as { name?: string } | undefined;
      await input.bus.publish({
        sessionId: input.session.session.id,
        eventType: 'action',
        kind: `tool_call.${data?.name ?? e.type}`,
        payload: e.data,
      });
    }

    const ok = execError === undefined && exitCode === 0;
    const runnerSummary = collected.summary.trim();
    const runnerError = ok
      ? undefined
      : execError
        ?? (exitCode != null && exitCode !== 0
          ? `pi-runner exited ${exitCode}`
          : runnerSummary.startsWith('Worker did not complete:')
            ? runnerSummary.slice('Worker did not complete:'.length).trim()
            : runnerSummary || `pi-runner exited ${exitCode ?? 'null'}`);

    if (ok && collected.summary && collected.summary.trim()) {
      await input.bus.publish({
        sessionId: input.session.session.id,
        eventType: 'turn',
        kind: 'assistant_message',
        payload: { role: 'assistant', content: [{ type: 'text', text: collected.summary }] },
      });
    } else if (!ok) {
      const failureText = runnerError ?? runnerSummary ?? 'Worker run failed without details.';
      await input.bus.publish({
        sessionId: input.session.session.id,
        eventType: 'turn',
        kind: 'assistant_message',
        payload: {
          role: 'assistant',
          content: [{ type: 'text', text: `Previous attempt failed: ${failureText}` }],
        },
      });
    }

    return {
      toolCalls: collected.events
        .filter((e) => e.type === 'tool_call')
        .map((e) => e.data as AgentTurnResult['toolCalls'][number]),
      finalMessage: collected.summary || undefined,
      finishReason: ok ? 'completed' : 'error',
      errorMessage: runnerError,
      usage: collected.usage,
      handoff: collected.handoff,
      mrRequest: collected.mrRequest,
      artifacts: collected.artifacts,
    };
  }
}
