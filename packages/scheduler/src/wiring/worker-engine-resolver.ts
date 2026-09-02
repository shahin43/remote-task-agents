import type { AgentEngine, AgentSpec } from '@remote-sandbox-agents/contracts';
import { AgentEngineRegistry, PiCodingAgentEngine } from '@remote-sandbox-agents/agent-engines';
import type { SandboxSession } from '@remote-sandbox-agents/sandbox';
import { PiRunnerEngineAdapter } from './pi-runner-engine-adapter.js';
import { piRunnerTemplate } from './agent-runtime-template.js';

export interface WorkerEngineResolverDeps {
  workerEnv: NodeJS.ProcessEnv;
  piProvider: string;
  piModel: string;
  piStoreRequests?: boolean;
  piRunnerBundlePath: string;
  piRunnerEnv: NodeJS.ProcessEnv;
}

export type WorkerEngineResolver = (spec: AgentSpec, sandboxSession?: SandboxSession) => AgentEngine;

export function makeWorkerEngineResolver(deps: WorkerEngineResolverDeps): WorkerEngineResolver {
  const registry = new AgentEngineRegistry<{ sandboxSession?: SandboxSession }>()
    .register('pi-agent', (_spec, ctx) => {
      if (ctx.sandboxSession) {
        return new PiRunnerEngineAdapter({
          sandboxSession: ctx.sandboxSession,
          template: piRunnerTemplate,
          bundlePath: deps.piRunnerBundlePath,
          provider: deps.piProvider,
          model: deps.piModel,
          env: { ...deps.piRunnerEnv } as Record<string, string>,
          storeRequests: deps.piStoreRequests,
        });
      }
      return new PiCodingAgentEngine({
        provider: deps.piProvider,
        model: deps.piModel,
        storeRequests: deps.piStoreRequests,
      });
    });

  return (spec, sandboxSession) => registry.create(spec, { sandboxSession });
}
