import type { WorkerProfile } from '../orchestrator/profile.js';

export interface SkillRef {
  name: string;
  source: 'service' | 'repo' | 'tenant';
  path?: string;
  description?: string;
  tags?: string[];
  requiresToolsets?: string[];
  enabled: boolean;
}

export interface SkillBody {
  name: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface SkillLoader {
  index(profile: WorkerProfile, repoRoot: string): Promise<SkillRef[]>;
  read(name: string): Promise<SkillBody>;
  readFile(name: string, relPath: string): Promise<string>;
}
