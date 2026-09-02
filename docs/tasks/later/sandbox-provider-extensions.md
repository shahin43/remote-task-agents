# Later — sandbox provider extensions (Phase 8+)

Spec §3 / §6 Phase 8+ / §7 non-goals. Indexed from [DEVELOPMENT.md](../../../DEVELOPMENT.md).

**Do not implement in this repo yet.** Shipped backends stay `sandbox-unix-local`
and `sandbox-docker`. Anything else registers against `SandboxProvider` out of
tree (or in a later SPI-proof PR) with zero core loop changes.

## Shipped (in-tree)

| Runtime | Isolation | When |
|---|---|---|
| `sandbox-unix-local` | host temp dir | unit tests, trusted laptop |
| `sandbox-docker` | container; Pi runner via `docker exec -i` | default e2e and profiles |

Selection: profile `runtime:` plus optional `REMOTE_AGENT_WORKER_RUNTIME` override.
`SandboxManager` looks up `ProviderOptions.type` (`unix_local` / `docker`).

## Extension-only (not in-tree)

Documented plugin targets, not work items now:

- AWS Lambda MicroVM (upstream reference remote impl)
- Self-managed Firecracker / Kata
- Hosted sandbox products (Modal, Daytona, Fly Machines, Cloud Run jobs)

Contract to implement later: `packages/sandbox/src/provider.ts` (`create` /
`resume` / `destroy` / serialize), same `/workspace` task-bundle layout, capability
fulfillment without putting raw keys in the model prompt, reconciler ownership
labels.

Exit for Phase 8: one out-of-tree provider registered with **zero** edits to the
board/control/worker loop.
