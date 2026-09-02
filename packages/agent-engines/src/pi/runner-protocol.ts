/**
 * The wire contract between the host (`PiRunnerEngineAdapter` /
 * `AgentRuntimeTemplate`) and the in-container `pi-runner` entrypoint. Both
 * sides import these types so the JSON written into the workspace and the result
 * read back stay in lockstep. Pure data; no runtime dependencies.
 */

/** Post-clamp scope handed to the runner via `task/scope.json`. */
export interface RunnerScope {
  /** Repo-relative paths the worker may touch (informational in v1; '.' = whole repo). */
  targetPaths: string[];
  /** Capabilities to expose as tools: 'filesystem' | 'shell' | 'apply_patch'. */
  capabilities: string[];
  /** Skill pack ids materialized under skills/ (informational in v1). */
  skills: string[];
}

/** A replayable conversation message (mirrors PiMessage; verbatim for caching). */
export interface RunnerMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

/** The agent spec slice handed to the runner via `.agent/spec.json`. */
export interface RunnerSpec {
  profileId: string;
  provider: string;
  model: string;
  maxTurns: number;
  systemPrompt: string;
  /** The current input/goal text (the latest channel.input). */
  input: string;
  /** Full prior conversation (latest input last). When present, seeds the loop
   *  instead of [{ role:'user', content: input }]. Omitted on first run. */
  messages?: RunnerMessage[];
  storeRequests?: boolean;
}

/** Machine-readable result the runner prints to stdout and the host parses. */
export interface RunnerResult {
  status: 'completed' | 'failed';
  summary: string;
  toolCount: number;
  error?: string;
}

/** One line in `.agent/events.jsonl`. */
export interface RunnerEvent {
  type: string;
  at: string;
  data: unknown;
}

export const RUNNER_PATHS = {
  spec: '.agent/spec.json',
  scope: 'task/scope.json',
  summary: 'artifacts/summary.md',
  events: '.agent/events.jsonl',
  usage: '.agent/usage.json',
  bundle: '.agent/pi-runner.js',
  /** Sidecar written by the `handoff` Pi tool; read by the harness after the run. */
  handoff: '.agent/handoff.json',
  /** Sidecar written by the `request_mr` Pi tool; read by the harness after the run. */
  mrRequest: '.agent/mr-request.json',
  /** Sidecar written by the artifact declare tool; read by the harness after the run. */
  artifactsManifest: '.agent/artifacts.json',
  repo: 'repo',
} as const;
