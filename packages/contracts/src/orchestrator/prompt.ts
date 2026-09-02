import type { WorkerProfile } from './profile.js';
import type { RemoteAgentTask } from '../gateway/gateway.js';

export interface PromptContract {
  system: string;
  cacheBreakpoints: number[];
  hash: string;
}

export interface PromptSection {
  id: string;
  content: string;
  bytes: number;
}

export interface PromptBuildContext {
  repoRoot: string;
  task?: RemoteAgentTask;
  soulContent?: string;
  basePromptContent?: string;
  memoryContent?: string;
  userContent?: string;
  contextFiles: Array<{ path: string; content: string; trustLevel: string }>;
}

export interface PromptModule {
  readonly id: string;
  readonly order: number;
  readonly cacheable: boolean;
  build(ctx: PromptBuildContext): Promise<PromptSection | null>;
}

export interface PromptBuilder {
  register(module: PromptModule): void;
  build(profile: WorkerProfile, ctx: PromptBuildContext): Promise<PromptContract>;
}
