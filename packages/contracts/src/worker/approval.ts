export interface ApprovalRequest {
  toolName?: string;
  command?: string[];
  filePath?: string;
  network?: boolean;
  cwd?: string;
}

export interface ApprovalContext {
  workspacePath: string;
  profileId: string;
  runtimeKind: string;
}

export type ApprovalDecision = 'accept' | 'decline';

export interface ApprovalPolicy {
  readonly id: string;
  decide(request: ApprovalRequest, ctx: ApprovalContext): ApprovalDecision;
}
