export interface ToolDescriptor {
  name: string;
  toolset: string;
  schema: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolInvocationContext {
  workspacePath: string;
  runId: string;
  profileId: string;
}

export interface ToolHandler {
  readonly name: string;
  invoke(args: unknown, ctx: ToolInvocationContext): Promise<ToolResult>;
}

export interface ToolGateContext {
  profileId: string;
  runtimeKind: string;
  toolsets: string[];
}

export interface ToolRegistry {
  register(descriptor: ToolDescriptor, handler: ToolHandler): void;
  describe(toolsets: string[]): ToolDescriptor[];
  dispatch(name: string, args: unknown, ctx: ToolInvocationContext): Promise<ToolResult>;
  available(ctx: ToolGateContext): ToolDescriptor[];
}
