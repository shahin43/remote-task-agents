import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PiToolDef, PiToolResult } from './loop.js';
import type { RunnerScope } from './runner-protocol.js';

/** A local tool: a pi tool definition plus an in-process executor. */
export interface LocalTool extends PiToolDef {
  invoke: (args: Record<string, unknown>) => Promise<PiToolResult>;
}

function fail(output: string): PiToolResult {
  return { success: false, output };
}

/**
 * Resolve a workspace-relative path and refuse anything that escapes `root`.
 * Returns the absolute path, or null if the path would escape the root.
 */
function resolveInRoot(root: string, p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel === '' ) return abs; // the root itself
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/**
 * Relative paths of a skill's payload files (everything except `SKILL.md`), capped so
 * a large skill cannot flood a tool result.
 */
async function listSkillPayload(dir: string, limit = 40): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    if (found.length >= limit) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (found.length >= limit) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else if (entry.isFile() && rel !== 'SKILL.md' && rel !== 'skill.manifest.json') found.push(rel);
    }
  }
  try {
    await walk(dir, '');
  } catch {
    return found;
  }
  return found.sort();
}

function runShell(cwd: string, command: string): Promise<PiToolResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => resolve(fail(`shell spawn error: ${e.message}`)));
    child.on('close', (code) => {
      const body = [out, err].filter(Boolean).join('\n').trim();
      resolve({ success: code === 0, output: `exit=${code ?? 'null'}\n${body}`.trim() });
    });
  });
}

/**
 * Build the local-FS tool pack rooted at `root` (the **workspace root** —
 * the directory that contains `repo/`, `task/`, `context/`, `artifacts/`,
 * `.agent/`, and the worker profile's `AGENTS.md`). File tools enforce
 * containment within `root` and `handoff` writes its sidecar at
 * `<root>/.agent/handoff.json` (which is exactly what the harness collector
 * reads back).
 *
 * `opts.execCwd` lets the caller pin shell + `apply_patch` to a specific
 * working directory inside the workspace (typically `<root>/repo` so `git`
 * commands "just work" without the agent having to `cd repo` every time).
 * Defaults to `root` for backwards compatibility.
 *
 * Only tools whose capability is present in `scope.capabilities` are
 * returned, so the scope-clamp (post-intersection) is reflected directly
 * in the tool surface.
 */
export function buildLocalTools(
  root: string,
  scope: RunnerScope,
  opts: { execCwd?: string } = {},
): LocalTool[] {
  const caps = new Set(scope.capabilities);
  const execCwd = opts.execCwd ?? root;
  const tools: LocalTool[] = [];

  if (caps.has('filesystem')) {
    tools.push({
      name: 'read_file',
      description: 'Read a UTF-8 file from the sandbox workspace. Paths are relative to the workspace root (e.g. "repo/README.md", "context/brief.md").',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      invoke: async (args) => {
        const abs = resolveInRoot(root, args.path);
        if (!abs) return fail(`path escapes workspace root: ${String(args.path)}`);
        try {
          return { success: true, output: await fs.readFile(abs, 'utf8') };
        } catch (e) {
          return fail(`read_file failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
    tools.push({
      name: 'write_file',
      description: 'Write a UTF-8 file in the sandbox workspace (creates parent dirs). Paths are relative to the workspace root (e.g. "repo/src/foo.ts").',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      invoke: async (args) => {
        const abs = resolveInRoot(root, args.path);
        if (!abs) return fail(`path escapes workspace root: ${String(args.path)}`);
        try {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, typeof args.content === 'string' ? args.content : String(args.content ?? ''));
          return { success: true, output: `wrote ${args.path}` };
        } catch (e) {
          return fail(`write_file failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
  }

  if (caps.has('shell')) {
    tools.push({
      name: 'shell',
      description: 'Run a shell command. Defaults its cwd to the repo working tree (so `git` commands "just work"). Use `cd ../` to step out into the broader workspace if you need to inspect `task/`, `context/`, etc.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      invoke: async (args) => {
        const command = typeof args.command === 'string' ? args.command
          : typeof args.cmd === 'string' ? args.cmd : null;
        if (!command) return fail('shell requires a "command" string');
        return runShell(execCwd, command);
      },
    });
  }

  // Only offered when the run resolved skills *and* holds the capability: an empty
  // tool that always errors teaches the model nothing except to distrust its tools.
  if (caps.has('skills') && scope.skills.length > 0) {
    tools.push({
      name: 'read_skill',
      description:
        'Load the full instructions for one of the skills available to this run. ' +
        'See `skills/INDEX.md` for the list. Read a skill before you use it, then follow it exactly. ' +
        'Payload files live under `skills/<id>/` and can be read with `read_file`.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill id from skills/INDEX.md, e.g. "repo-orientation".' },
        },
        required: ['id'],
      },
      invoke: async (args) => {
        const id = typeof args.id === 'string' ? args.id : typeof args.skill === 'string' ? args.skill : null;
        if (!id) return fail('read_skill requires an "id" string');
        // The scope list is the allowlist, so an id can never point outside the
        // skills the harness resolved for this run.
        if (!scope.skills.includes(id)) {
          return fail(`read_skill: "${id}" is not available to this run. Available: ${scope.skills.join(', ')}`);
        }
        const dir = resolveInRoot(root, path.posix.join('skills', id));
        if (!dir) return fail(`read_skill: skill path escapes workspace root: ${id}`);
        try {
          const body = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
          const payload = await listSkillPayload(dir);
          const suffix = payload.length > 0
            ? `\n\n---\nPayload files (read with read_file): ${payload.map((p) => `skills/${id}/${p}`).join(', ')}`
            : '';
          return { success: true, output: `${body}${suffix}` };
        } catch (e) {
          return fail(`read_skill failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
  }

  if (caps.has('handoff')) {
    tools.push({
      name: 'handoff',
      description:
        'Hand off the current board task to another agent or to a human. ' +
        'Call this exactly once, as your final action. ' +
        'Use targetKind "agent" only when another agent should own the next turn ' +
        '(the harness will start that worker). Use targetKind "user" when a human should ' +
        'take it — the harness will not start a worker. ' +
        'The harness reads the resulting file after your run and applies the reassignment.',
      parameters: {
        type: 'object',
        properties: {
          targetKind: { type: 'string', enum: ['agent', 'user'] },
          targetId: {
            type: 'string',
            description: 'Board principal id, e.g. "agent-reviewer" or "user-dev".',
          },
          status: {
            type: 'string',
            enum: ['backlog', 'triaging', 'working', 'review', 'done', 'failed'],
            description:
              'Optional board status hint. For agent targets the harness routes the next worker even if you pass "review". For humans, "review" waits on the board and "done" closes.',
          },
          message: {
            type: 'string',
            description: 'Optional handoff note shown on the board task timeline.',
          },
        },
        required: ['targetKind', 'targetId'],
      },
      invoke: async (args) => {
        const targetKind = args.targetKind;
        const targetId = args.targetId;
        if (targetKind !== 'agent' && targetKind !== 'user') {
          return fail(`handoff: targetKind must be "agent" or "user", got ${String(targetKind)}`);
        }
        if (typeof targetId !== 'string' || targetId.length === 0) {
          return fail('handoff: targetId is required and must be a non-empty string');
        }
        const ALLOWED_STATUSES = ['backlog', 'triaging', 'working', 'review', 'done', 'failed'];
        const payload: Record<string, unknown> = { targetKind, targetId };
        if (args.status != null) {
          if (typeof args.status !== 'string' || !ALLOWED_STATUSES.includes(args.status)) {
            return fail(`handoff: status must be one of ${ALLOWED_STATUSES.join(', ')}, got ${String(args.status)}`);
          }
          payload.status = args.status;
        }
        if (typeof args.message === 'string' && args.message.length > 0) {
          payload.message = args.message;
        }
        try {
          const agentDir = path.join(root, '.agent');
          await fs.mkdir(agentDir, { recursive: true });
          await fs.writeFile(
            path.join(agentDir, 'handoff.json'),
            JSON.stringify(payload, null, 2) + '\n',
          );
          return { success: true, output: `handoff recorded → ${targetKind}:${targetId}` };
        } catch (e) {
          return fail(`handoff failed to write: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
  }

  if (caps.has('request_mr')) {
    tools.push({
      name: 'request_mr',
      description:
        'Request the harness to open a draft merge request after this run is checkpointed. ' +
        'You do NOT push or open the MR yourself — the trusted harness does that after operator approval. ' +
        'Call this when implementation and tests are complete, then call `handoff` to route the task.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Concise MR title.' },
          summary: { type: 'string', description: 'Short MR description (tests run, scope, risks).' },
          targetBranch: {
            type: 'string',
            description: 'Advisory target branch (harness clamps to repo policy). Default main.',
          },
          draft: {
            type: 'boolean',
            description: 'Open as draft MR. Default true.',
          },
          handoffTo: {
            type: 'string',
            description: 'Optional principal id hint for follow-up routing (handoff tool remains primary).',
          },
        },
        required: ['title', 'summary'],
      },
      invoke: async (args) => {
        const title = args.title;
        const summary = args.summary ?? args.description;
        if (typeof title !== 'string' || title.trim().length === 0) {
          return fail('request_mr: title is required and must be a non-empty string');
        }
        if (typeof summary !== 'string' || summary.trim().length === 0) {
          return fail('request_mr: summary is required and must be a non-empty string');
        }
        const payload: Record<string, unknown> = {
          title: title.trim(),
          summary: summary.trim(),
          targetBranch:
            typeof args.targetBranch === 'string' && args.targetBranch.length > 0
              ? args.targetBranch
              : 'main',
          draft: args.draft === undefined ? true : Boolean(args.draft),
        };
        if (typeof args.handoffTo === 'string' && args.handoffTo.length > 0) {
          payload.handoffTo = args.handoffTo;
        }
        try {
          const agentDir = path.join(root, '.agent');
          await fs.mkdir(agentDir, { recursive: true });
          await fs.writeFile(
            path.join(agentDir, 'mr-request.json'),
            JSON.stringify(payload, null, 2) + '\n',
          );
          return { success: true, output: `MR request recorded: ${payload.title}` };
        } catch (e) {
          return fail(`request_mr failed to write: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
  }

  if (caps.has('apply_patch')) {
    tools.push({
      name: 'apply_patch',
      description: 'Apply a unified diff to the repo working tree via `git apply`.',
      parameters: { type: 'object', properties: { patch: { type: 'string' } }, required: ['patch'] },
      invoke: async (args) => {
        const patch = typeof args.patch === 'string' ? args.patch : null;
        if (!patch) return fail('apply_patch requires a "patch" string');
        return new Promise<PiToolResult>((resolve) => {
          const child = spawn('git', ['apply', '--whitespace=nowarn', '-'], { cwd: execCwd });
          let err = '';
          child.stderr.on('data', (d) => { err += d.toString(); });
          child.on('error', (e) => resolve(fail(`git apply spawn error: ${e.message}`)));
          child.on('close', (code) => resolve(code === 0
            ? { success: true, output: 'patch applied' }
            : fail(`git apply failed (exit ${code}): ${err.trim()}`)));
          child.stdin.end(patch);
        });
      },
    });
  }

  return tools;
}
