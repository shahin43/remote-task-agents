import type {
  AgentEngine,
  AgentEngineInput,
  AgentTurnResult,
  ToolCallRecord,
} from '@remote-sandbox-agents/contracts';

export interface MockTurnPlan {
  toolCalls?: Array<Pick<ToolCallRecord, 'name' | 'args'> & { willSucceed?: boolean; output?: string }>;
  finalMessage?: string;
  finishReason?: AgentTurnResult['finishReason'];
}

export class MockAgentEngine implements AgentEngine {
  readonly kind = 'mock';
  private readonly plans: MockTurnPlan[];
  private cursor = 0;

  constructor(plans: MockTurnPlan[]) {
    this.plans = plans;
  }

  async runTurn(input: AgentEngineInput): Promise<AgentTurnResult> {
    const plan = this.plans[this.cursor++] ?? { finishReason: 'completed' };
    const calls: ToolCallRecord[] = [];
    for (const c of plan.toolCalls ?? []) {
      const startedAt = new Date().toISOString();
      const invocationResult = await input.spec.tools.invoke(c.name, c.args, {
        runId: input.session.session.id,
        profileId: input.spec.id,
        workspacePath: '/dev/null',
      });
      const endedAt = new Date().toISOString();
      const result = c.willSucceed === false
        ? { success: false, output: '', error: c.output ?? 'forced failure' }
        : invocationResult;
      calls.push({
        callId: `mock-${calls.length}`,
        name: c.name,
        args: c.args,
        result,
        startedAt,
        endedAt,
      });
    }
    return {
      toolCalls: calls,
      finalMessage: plan.finalMessage,
      finishReason: plan.finishReason ?? (plan.toolCalls?.length ? 'tool_call_only' : 'completed'),
    };
  }
}
