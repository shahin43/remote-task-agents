import type { AgentRunRecord } from '@remote-sandbox-agents/persistence';

export interface TaskUsageAttempt {
  runId: string;
  attemptNumber: number;
  agentSpecId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface TaskUsageView {
  taskId: string;
  attemptCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  attempts: TaskUsageAttempt[];
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function extractUsageTotals(tokenUsage: Record<string, unknown> | null | undefined): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
} {
  if (!tokenUsage) return { inputTokens: 0, outputTokens: 0, costUsd: null };
  const inputTokens =
    asNumber(tokenUsage.input) ?? asNumber(tokenUsage.prompt_tokens) ?? asNumber(tokenUsage.promptTokens) ?? 0;
  const outputTokens =
    asNumber(tokenUsage.output) ??
    asNumber(tokenUsage.completion_tokens) ??
    asNumber(tokenUsage.completionTokens) ??
    0;
  let costUsd: number | null = null;
  if (tokenUsage.cost && typeof tokenUsage.cost === 'object') {
    costUsd = asNumber((tokenUsage.cost as Record<string, unknown>).total);
  } else {
    costUsd = asNumber(tokenUsage.cost_usd) ?? asNumber(tokenUsage.cost);
  }
  return { inputTokens, outputTokens, costUsd };
}

export function rollupTaskUsage(taskId: string, runs: AgentRunRecord[]): TaskUsageView {
  const attempts: TaskUsageAttempt[] = runs.map((run) => {
    const totals = extractUsageTotals(run.tokenUsage);
    return {
      runId: run.id,
      attemptNumber: run.attemptNumber,
      agentSpecId: run.agentSpecId,
      ...totals,
    };
  });
  const inputTokens = attempts.reduce((sum, a) => sum + a.inputTokens, 0);
  const outputTokens = attempts.reduce((sum, a) => sum + a.outputTokens, 0);
  const costParts = attempts.map((a) => a.costUsd).filter((n): n is number => n != null);
  return {
    taskId,
    attemptCount: attempts.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: costParts.length > 0 ? costParts.reduce((sum, n) => sum + n, 0) : null,
    attempts,
  };
}
