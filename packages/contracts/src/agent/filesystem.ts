export type FilesystemMode = 'none' | 'read-only' | 'scoped' | 'full';

export interface FilesystemAccess {
  readonly mode: FilesystemMode;
  readonly root?: string;
  readonly allowList?: string[];
}
