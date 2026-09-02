import fs from 'node:fs/promises';
import path from 'node:path';
import { runPiLoop, formatStreamError, type PiLoopEvent, type PiToolDef } from './loop.js';
import { buildLocalTools } from './local-tools.js';
import { RUNNER_PATHS, type RunnerSpec, type RunnerScope, type RunnerResult, type RunnerEvent } from './runner-protocol.js';
import type { PiAiLike } from './pi-engine.js';

export interface RunMainDeps {
  /** Inject a fake pi-ai for tests; defaults to the real package. */
  piAi?: PiAiLike;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * The in-container worker entrypoint. Reads the spec + scope written into the
 * workspace, runs the shared pi loop with local-FS tools, and writes the task
 * artifacts (summary, events, usage). Returns a machine-readable result.
 *
 * `root` is the sandbox workspace root (contains repo/, task/, .agent/, ...).
 */
export async function runMain(root: string, deps: RunMainDeps = {}): Promise<RunnerResult> {
  const piAi = deps.piAi ?? ((await import('@earendil-works/pi-ai')) as unknown as PiAiLike);

  const spec = await readJson<RunnerSpec | null>(path.join(root, RUNNER_PATHS.spec), null);
  if (!spec) {
    return { status: 'failed', summary: '', toolCount: 0, error: `missing ${RUNNER_PATHS.spec}` };
  }
  const scope = await readJson<RunnerScope>(path.join(root, RUNNER_PATHS.scope), {
    targetPaths: ['.'],
    capabilities: ['filesystem', 'shell'],
    skills: [],
  });

  // Tools are rooted at the *workspace* (so the agent can read its own
  // `AGENTS.md`, `task/scope.json`, `context/`, and `repo/...` via paths that
  // match the prompts) and they write `.agent/handoff.json` at the workspace
  // root, which is exactly what the harness collector reads back. Shell +
  // `apply_patch` default their cwd to `repo/` so `git` commands "just work".
  const repoDir = path.join(root, RUNNER_PATHS.repo);
  await fs.mkdir(repoDir, { recursive: true });
  const tools = buildLocalTools(root, scope, { execCwd: repoDir });
  const toolDefs: PiToolDef[] = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const byName = new Map(tools.map((t) => [t.name, t]));

  const events: RunnerEvent[] = [];
  const onEvent = (e: PiLoopEvent): void => {
    events.push({ type: e.type, at: new Date().toISOString(), data: e.data });
  };

  const loop = await runPiLoop({
    piAi,
    provider: spec.provider,
    model: spec.model,
    systemPrompt: spec.systemPrompt,
    messages: spec.messages && spec.messages.length > 0
      ? spec.messages
      : [{ role: 'user', content: spec.input }],
    toolDefs,
    invokeTool: async (name, args) => {
      const tool = byName.get(name);
      if (!tool) return { success: false, output: `unknown tool: ${name}` };
      return tool.invoke(args);
    },
    maxTurns: spec.maxTurns,
    signal: new AbortController().signal,
    storeRequests: spec.storeRequests,
    onEvent,
  });

  const ok = loop.finishReason === 'completed' || loop.finishReason === 'tool_call_only';
  const errText = loop.errorMessage ? formatStreamError(loop.errorMessage) : loop.finishReason;
  const summary = loop.finalMessage
    ?? (ok ? 'Worker completed the task.' : `Worker did not complete: ${errText}`);

  // Write artifacts (best-effort; surfaces in the snapshot + status-back).
  await fs.mkdir(path.join(root, '.agent'), { recursive: true });
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, RUNNER_PATHS.summary), `# Task summary\n\n${summary}\n`);
  await fs.writeFile(path.join(root, RUNNER_PATHS.events), events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
  await fs.writeFile(path.join(root, RUNNER_PATHS.usage), JSON.stringify(loop.usage ?? {}, null, 2));

  return {
    status: ok ? 'completed' : 'failed',
    summary,
    toolCount: loop.toolCalls.length,
    error: ok ? undefined : errText,
  };
}
