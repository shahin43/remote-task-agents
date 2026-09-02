import type { ToolDescriptor, ToolResult, ToolInvocationContext } from '../tools/registry.js';

export type ToolScope = 'orchestrator' | 'worker';

export interface ToolProvider {
  list(scope: ToolScope): ToolDescriptor[];
  invoke(name: string, args: unknown, ctx: ToolInvocationContext): Promise<ToolResult>;
}
