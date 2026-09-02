import type { WorkerProfile } from '../orchestrator/profile.js';
import type { PromptContract } from '../orchestrator/prompt.js';
import type { ToolDescriptor } from '../tools/registry.js';
import type { SkillRef } from '../skills/loader.js';
import type { WorkspaceSpec } from './workspace.js';

export interface RunDescriptor {
  runId: string;
  attempt: number;
  leaseExpiresAt: string;
  taskKey: string;
}

export interface SecretRef {
  id: string;
  ref: string;
  consumedBy: 'engine' | 'provider' | 'runtime';
}

export interface EventSinkSpec {
  kind: 'stdio-jsonl' | 'file' | 's3';
  path?: string;
}

export interface HandoffEnvelope {
  run: RunDescriptor;
  profile: WorkerProfile;
  promptContract: PromptContract;
  toolset: ToolDescriptor[];
  skills: SkillRef[];
  workspace: WorkspaceSpec;
  secrets: SecretRef[];
  env: Record<string, string>;
  events: EventSinkSpec;
}
