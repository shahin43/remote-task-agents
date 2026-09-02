export interface PiResourceLoaderLike {
  getExtensions(): unknown;
  getSkills(): unknown;
  getPrompts(): unknown;
  getThemes(): unknown;
  getAgentsFiles(): unknown;
  getSystemPrompt(): string | undefined;
  getAppendSystemPrompt(): string[];
  extendResources(paths: unknown): void;
  reload(): Promise<void>;
  [key: string]: unknown;
}

export function makePromptOnlyLoader(systemPrompt: string): PiResourceLoaderLike {
  return {
    getExtensions: () => ({ extensions: [], errors: [], hooks: [] }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources() {},
    async reload() {},
  };
}
