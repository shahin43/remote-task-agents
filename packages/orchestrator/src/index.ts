export { ScopedToolRegistry } from './tools/index.js';
export { clampScope, ScopeDeniedError } from './tools/scope-clamp.js';
export {
  AgentConfigLoader,
  toWorkerProfile,
  type AgentProfileConfig,
  type ResolvedAgentConfig,
  type AgentSources,
  type AgentConfigLoaderOptions,
} from './config/agent-config-loader.js';
export { WorkspaceManager, type SessionWorkspace } from './workspace/workspace-manager.js';
export {
  BoardAssignmentRouter,
  type AssignmentRouterOptions,
  type AssigneeTarget,
  type RouteOutcome,
} from './board/index.js';
