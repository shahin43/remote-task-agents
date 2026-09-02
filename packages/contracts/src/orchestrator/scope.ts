/** A mount the orchestrator may REQUEST for a worker session. */
export interface MountRequest {
  kind: 'git' | 's3';
  /** For git: repo slug/path. For s3: bucket. */
  ref: string;
  /** workspace-relative destination directory. */
  dest: string;
  /** git: branch/tag/sha to start from. s3: prefix. */
  at?: string;
  /** s3 only: read-only mount (no sync-back). Default true. */
  readOnly?: boolean;
}

/** The harness POLICY ceiling for a worker profile (the trusted allowlist). */
export interface ScopePolicy {
  /** Pre-enabled repos the profile may mount. '*' is NOT allowed. */
  allowedRepos: string[];
  /** Mount kinds the profile may use. */
  allowedMountTypes: Array<'git' | 's3' | 'local-dir'>;
  /** Glob roots the worker may mount/write. Empty/undefined = whole repo. */
  pathAllowlist?: string[];
  /** Always-denied globs (e.g. '**\/.env'). */
  pathDenylist?: string[];
  /** Cap on requested path count to bound a runaway request. */
  maxMountedPaths?: number;
  /** Hosts the sandbox may reach (enforced for real at the Docker stage). */
  egressAllowlist?: string[];
}

/** What the orchestrator LLM requests in dispatch_job (the untrusted ask). */
export interface ScopeRequest {
  targetPaths?: string[];
  mounts?: MountRequest[];
}

/** The clamped, policy-bounded result that becomes the worker's effective scope. */
export interface EffectiveScope {
  targetPaths: string[];
  mounts: MountRequest[];
}
