import type { AgentEngine, AgentSpec } from '@remote-sandbox-agents/contracts';

/**
 * Factory for one engine kind. `C` is an optional build context (e.g. the
 * sandbox session for workers); orchestrator usage leaves it `void`.
 */
export type EngineFactory<C = void> = (spec: AgentSpec, ctx: C) => AgentEngine;

/**
 * Selects an {@link AgentEngine} by `spec.engine.kind`. Pi is first-class:
 * callers register `pi-agent` and (optionally) `pi-agent` or
 * other engines. This is the engine-selection port — consumers depend on the
 * registry, never on a concrete engine class; concretes are wired at the
 * composition root.
 */
export class AgentEngineRegistry<C = void> {
  private readonly factories = new Map<string, EngineFactory<C>>();

  register(kind: string, factory: EngineFactory<C>): this {
    this.factories.set(kind, factory);
    return this;
  }

  has(kind: string): boolean {
    return this.factories.has(kind);
  }

  create(spec: AgentSpec, ctx: C = undefined as C): AgentEngine {
    const factory = this.factories.get(spec.engine.kind);
    if (!factory) throw new Error(`no engine registered for kind: ${spec.engine.kind}`);
    return factory(spec, ctx);
  }
}
