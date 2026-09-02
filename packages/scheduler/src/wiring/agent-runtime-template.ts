import fs from 'node:fs/promises';
import path from 'node:path';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';
import type { TokenUsage } from '@remote-sandbox-agents/contracts';
import { RUNNER_PATHS, type RunnerSpec, type RunnerScope, type RunnerEvent } from '@remote-sandbox-agents/agent-engines';

/** Inputs the host hands to a template to prepare a worker run. */
export interface RuntimeMaterializeCtx {
  spec: RunnerSpec;
  scope: RunnerScope;
  /** Host path to the bundled runner artifact to mount/write into the container. */
  bundlePath: string;
}

/** What the host reads back after the in-container run completes. */
export interface RuntimeCollectResult {
  summary: string;
  events: RunnerEvent[];
  usage?: TokenUsage;
  /**
   * Raw `.agent/handoff.json` contents, if the agent wrote one via the
   * `handoff` Pi tool. Parsed + validated by the harness applier; left
   * as `unknown` here so the template stays free of board concerns.
   */
  handoff?: unknown;
  /** Raw `.agent/mr-request.json` contents when the agent called `request_mr`. */
  mrRequest?: unknown;
  /** Raw `.agent/artifacts.json` contents when the agent declared artifacts. */
  artifacts?: unknown;
}

/**
 * The "template for engine app server or pi agent" — a runtime delivered into the
 * sandbox container and launched there. An implementation knows how to put its
 * runtime + task into the workspace (`materialize`), what command starts it
 * (`launch`), and how to read its results back (`collect`).
 */
export interface AgentRuntimeTemplate {
  readonly id: string;
  materialize(session: SandboxSession, ctx: RuntimeMaterializeCtx): Promise<void>;
  launch(session: SandboxSession): { command: string; args: string[] };
  collect(session: SandboxSession): Promise<RuntimeCollectResult>;
}

const STANDARD_DIRS = ['.agent', 'task', 'context', 'skills', 'artifacts', 'repo'];

async function readSessionFile(session: SandboxSession, rel: string): Promise<string | undefined> {
  try {
    const stream = await session.read(rel);
    let out = '';
    for await (const chunk of stream) out += chunk.toString();
    return out;
  } catch {
    return undefined;
  }
}

function parseEvents(jsonl: string | undefined): RunnerEvent[] {
  if (!jsonl) return [];
  return jsonl
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as RunnerEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is RunnerEvent => e !== null);
}

function parseJsonSidecar(raw: string | undefined): unknown {
  if (!raw || raw.trim().length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalidJson: true, raw };
  }
}

/**
 * Model B for pi: write a self-contained `pi-runner` bundle + the spec/scope
 * into the workspace, launch `node .agent/pi-runner.js <root>` in the container,
 * and collect the artifacts/events it produced.
 */
export const piRunnerTemplate: AgentRuntimeTemplate = {
  id: 'pi-runner',

  async materialize(session, ctx) {
    await session.exec(['mkdir', '-p', ...STANDARD_DIRS], { shell: false });
    const bundle = await fs.readFile(ctx.bundlePath);
    await session.write(RUNNER_PATHS.bundle, bundle);
    await session.write(RUNNER_PATHS.spec, JSON.stringify(ctx.spec));
    await session.write(RUNNER_PATHS.scope, JSON.stringify(ctx.scope));
  },

  launch(session) {
    const root = session.state.workspaceRoot;
    return { command: 'node', args: [path.posix.join(root, RUNNER_PATHS.bundle), root] };
  },

  async collect(session) {
    const summaryRaw = await readSessionFile(session, RUNNER_PATHS.summary);
    const events = parseEvents(await readSessionFile(session, RUNNER_PATHS.events));
    let usage: TokenUsage | undefined;
    const usageRaw = await readSessionFile(session, RUNNER_PATHS.usage);
    if (usageRaw) {
      try {
        const parsed = JSON.parse(usageRaw) as TokenUsage;
        if (parsed && Object.keys(parsed).length > 0) usage = parsed;
      } catch {
        /* tolerate malformed usage */
      }
    }
    const summary = (summaryRaw ?? '').replace(/^# Task summary\n+/, '').trim();
    const handoff = parseJsonSidecar(await readSessionFile(session, RUNNER_PATHS.handoff));
    const mrRequest = parseJsonSidecar(await readSessionFile(session, RUNNER_PATHS.mrRequest));
    const artifacts = parseJsonSidecar(await readSessionFile(session, RUNNER_PATHS.artifactsManifest));
    return { summary, events, usage, handoff, mrRequest, artifacts };
  },
};
