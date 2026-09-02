import type { Manifest } from '../manifest.js';
import type { SandboxSession } from '../session.js';
import type { Capability } from './capability.js';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ApprovalPolicy = 'never' | 'on-request' | 'untrusted';

export interface PermissionsCapabilitySpec {
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  writableRoots: string[];
  deniedPaths: string[];
  egressAllowlist: string[];
}

export interface EngineSandboxConfig {
  sandbox: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  writableRoots: string[];
}

/** Translate a simple glob (`**`, `*`) to a RegExp. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*');
  return new RegExp(`^${pattern}$`);
}

/**
 * The SINGLE AUTHORITY for sandbox mode, writable roots, denied paths, and egress.
 * Projects down into the engine's sandbox config so the two layers cannot disagree.
 */
export class PermissionsCapability implements Capability {
  readonly type = 'permissions';
  private session?: SandboxSession;
  private readonly deniedRe: RegExp[];

  constructor(public readonly spec: PermissionsCapabilitySpec) {
    this.deniedRe = spec.deniedPaths.map(globToRegExp);
  }

  bind(session: SandboxSession): void { this.session = session; }
  processManifest(manifest: Manifest): Manifest { return manifest; }
  async resolve(): Promise<void> { /* nothing deferred in v1 */ }

  toEngineConfig(): EngineSandboxConfig {
    return {
      sandbox: this.spec.sandboxMode,
      approvalPolicy: this.spec.approvalPolicy,
      writableRoots: this.spec.writableRoots,
    };
  }

  isPathDenied(workspaceRelPath: string): boolean {
    return this.deniedRe.some((re) => re.test(workspaceRelPath));
  }

  isEgressAllowed(host: string): boolean {
    return this.spec.egressAllowlist.includes(host);
  }
}
