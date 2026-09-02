export interface PolicySet {
  approvalPolicy: 'never' | 'on-request' | 'untrusted';
  maxTurns: number;
  turnTimeoutMs: number;
  maxToolCalls: number;
  maxRuntimeMinutes: number;
}
