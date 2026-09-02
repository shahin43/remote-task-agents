import type { ToolDescriptor, ToolInvocationContext, ToolProvider } from '@remote-sandbox-agents/contracts';

export interface PiToolHandle {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (callId: string, params: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }>;
}

export function buildPiTools(provider: ToolProvider, ctx: ToolInvocationContext): PiToolHandle[] {
  return provider.list('orchestrator').map((descriptor) => piToolFromDescriptor(descriptor, provider, ctx));
}

function piToolFromDescriptor(
  descriptor: ToolDescriptor,
  provider: ToolProvider,
  ctx: ToolInvocationContext,
): PiToolHandle {
  return {
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.schema.description ? String(descriptor.schema.description) : descriptor.name,
    parameters: descriptor.schema,
    async execute(_callId, params) {
      const result = await provider.invoke(descriptor.name, params, ctx);
      const text = result.success ? result.output : `ERROR: ${result.error ?? 'tool failed'}`;
      return { content: [{ type: 'text', text }], details: { success: result.success } };
    },
  };
}
