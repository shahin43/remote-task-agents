import type { ToolDescriptor, ToolHandler, ToolProvider } from '@remote-sandbox-agents/contracts';
import { ScopedToolRegistry } from '@remote-sandbox-agents/orchestrator';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';

/**
 * Maximum bytes of a file read returned to the model. Larger files are truncated
 * with a marker so a runaway read never blows up the context window.
 */
const MAX_READ_BYTES = 256 * 1024;

async function streamToString(readable: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of readable) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total <= MAX_READ_BYTES) chunks.push(buf);
  }
  const out = Buffer.concat(chunks).toString('utf8');
  return total > MAX_READ_BYTES ? `${out}\n…[truncated ${total - MAX_READ_BYTES} bytes]` : out;
}

export interface SandboxToolPackOptions {
  /** Default exec timeout in ms (overridable per call). */
  defaultTimeoutMs?: number;
}

/**
 * Build the worker-scope pi tool surface bound to a live SandboxSession (Model A):
 * the pi inference loop runs host-side while these capability tools execute INSIDE
 * the sandbox via the session's exec/read/write. This is the D2 binding of pi tools
 * to sandbox capabilities. Scope enforcement (path clamping) is applied at dispatch
 * time via the existing scope-clamp; per-call clamping is a follow-up.
 */
export function makeSandboxToolProvider(session: SandboxSession, opts: SandboxToolPackOptions = {}): ToolProvider {
  const registry = new ScopedToolRegistry();
  for (const { descriptor, handler } of sandboxToolBundles(session, opts)) {
    registry.register('worker', descriptor, handler);
  }
  return registry;
}

export function sandboxToolBundles(
  session: SandboxSession,
  opts: SandboxToolPackOptions = {},
): Array<{ descriptor: ToolDescriptor; handler: ToolHandler }> {
  const shell: ToolDescriptor = {
    name: 'shell',
    toolset: 'sandbox',
    schema: {
      type: 'object',
      description: 'Run a shell command inside the sandbox workspace. Returns stdout/stderr/exitCode.',
      properties: {
        cmd: { type: 'string', description: 'The command line to run.' },
        cwd: { type: 'string', description: 'Optional working dir relative to the workspace root.' },
        timeout_ms: { type: 'number' },
      },
      required: ['cmd'],
    },
  };
  const readFile: ToolDescriptor = {
    name: 'read_file',
    toolset: 'sandbox',
    schema: {
      type: 'object',
      description: 'Read a workspace-relative file from the sandbox.',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  };
  const writeFile: ToolDescriptor = {
    name: 'write_file',
    toolset: 'sandbox',
    schema: {
      type: 'object',
      description: 'Write (create/overwrite) a workspace-relative file in the sandbox.',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  };

  const shellHandler: ToolHandler = {
    name: 'shell',
    async invoke(rawArgs) {
      const args = rawArgs as { cmd: string; cwd?: string; timeout_ms?: number };
      if (!args.cmd) return { success: false, output: '', error: 'cmd is required' };
      try {
        const res = await session.exec(args.cmd, {
          cwd: args.cwd,
          timeoutMs: args.timeout_ms ?? opts.defaultTimeoutMs,
        });
        const body = JSON.stringify({ exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr });
        return { success: res.exitCode === 0, output: body, error: res.exitCode === 0 ? undefined : `exit ${res.exitCode}` };
      } catch (err) {
        return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
  const readHandler: ToolHandler = {
    name: 'read_file',
    async invoke(rawArgs) {
      const args = rawArgs as { path: string };
      if (!args.path) return { success: false, output: '', error: 'path is required' };
      try {
        const stream = await session.read(args.path);
        return { success: true, output: await streamToString(stream) };
      } catch (err) {
        return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
  const writeHandler: ToolHandler = {
    name: 'write_file',
    async invoke(rawArgs) {
      const args = rawArgs as { path: string; content: string };
      if (!args.path) return { success: false, output: '', error: 'path is required' };
      try {
        await session.write(args.path, args.content ?? '');
        return { success: true, output: `wrote ${args.path}` };
      } catch (err) {
        return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [
    { descriptor: shell, handler: shellHandler },
    { descriptor: readFile, handler: readHandler },
    { descriptor: writeFile, handler: writeHandler },
  ];
}
