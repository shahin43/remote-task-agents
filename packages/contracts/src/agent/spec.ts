import type { AgentActor } from './session.js';
import type { PromptSource } from './prompt-source.js';
import type { ToolProvider } from './tool-provider.js';
import type { WorkspaceProvider } from './workspace-provider.js';
import type { FilesystemAccess } from './filesystem.js';
import type { PolicySet } from './policies.js';
import type { SkillLoader } from '../skills/loader.js';
import type { SecretsResolver } from '../secrets/index.js';

export interface AgentEngineRef {
  kind: string;
  version?: string;
  options?: Record<string, unknown>;
}

export interface AgentSpec {
  id: string;
  actor: AgentActor;
  engine: AgentEngineRef;
  prompt: PromptSource;
  tools: ToolProvider;
  skills: SkillLoader;
  workspace: WorkspaceProvider;
  secrets: SecretsResolver;
  fs: FilesystemAccess;
  policies: PolicySet;
  metadata: Record<string, string>;
}
