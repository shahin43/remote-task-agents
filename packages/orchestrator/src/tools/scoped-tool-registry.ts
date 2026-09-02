import type {
  ToolDescriptor,
  ToolHandler,
  ToolInvocationContext,
  ToolProvider,
  ToolResult,
  ToolScope,
} from '@remote-sandbox-agents/contracts';

interface Entry {
  descriptor: ToolDescriptor;
  handler: ToolHandler;
}

export class ScopedToolRegistry implements ToolProvider {
  private readonly byScope = new Map<ToolScope, Map<string, Entry>>();

  register(scope: ToolScope, descriptor: ToolDescriptor, handler: ToolHandler): void {
    if (!this.byScope.has(scope)) this.byScope.set(scope, new Map());
    const bucket = this.byScope.get(scope)!;
    if (bucket.has(descriptor.name)) {
      throw new Error(`tool '${descriptor.name}' already registered in scope '${scope}'`);
    }
    bucket.set(descriptor.name, { descriptor, handler });
  }

  list(scope: ToolScope): ToolDescriptor[] {
    return Array.from(this.byScope.get(scope)?.values() ?? []).map((e) => e.descriptor);
  }

  async invoke(name: string, args: unknown, ctx: ToolInvocationContext): Promise<ToolResult> {
    for (const bucket of this.byScope.values()) {
      const entry = bucket.get(name);
      if (entry) return entry.handler.invoke(args, ctx);
    }
    throw new Error(`unknown tool: ${name}`);
  }
}
