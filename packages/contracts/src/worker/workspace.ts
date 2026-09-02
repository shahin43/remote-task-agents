export type MountType = 'local-copy' | 'volume-mount' | 's3-prefix' | 'efs';
export type GitPolicy = 'exclude' | 'preserve';

export interface WorkspaceSpec {
  source: string;
  targetPaths: string[];
  gitPolicy: GitPolicy;
  mountType: MountType;
}
