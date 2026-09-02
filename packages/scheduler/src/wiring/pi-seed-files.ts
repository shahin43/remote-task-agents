import { renderSkillsPromptSection } from '@remote-sandbox-agents/skills';

import type { BundleFile } from './task-bundle.js';

export interface PiSeedSpecInput {
  profileId: string;
  soul: string;
  basePrompt: string;
  skillIds: readonly string[];
  input: string;
  provider: string;
  model: string;
  maxTurns: number;
  storeRequests?: boolean;
}

/** User-facing prompt written into the seed for remote guest (no later host materialize). */
export function promptFromSessionMetadata(metadata: Record<string, unknown>): string {
  const files = metadata.contextFiles as Array<{ path?: string; content?: string }> | undefined;
  const brief = files?.find((f) => typeof f.path === 'string' && f.path.includes('task-brief'));
  if (typeof brief?.content === 'string' && brief.content.trim()) return brief.content.trim();
  if (typeof metadata.goal === 'string' && metadata.goal.trim()) return metadata.goal.trim();
  return [
    'Read context/task-brief.md and skills/INDEX.md.',
    'Complete the assigned board task.',
    'Write generated papers and extracts under artifacts/.',
  ].join(' ');
}

/**
 * Pi runner files that Docker used to write during `materialize`.
 * remote guest must ship them in the snapshot seed or the guest falls back to a coding POC prompt.
 */
export function piSeedEngineFiles(input: PiSeedSpecInput): BundleFile[] {
  const skillsSection = renderSkillsPromptSection(input.skillIds.map((id) => ({ id })));
  const systemPrompt = [input.soul.trim(), input.basePrompt.trim(), skillsSection]
    .filter((part) => part.length > 0)
    .join('\n\n');
  const spec = {
    profileId: input.profileId,
    provider: input.provider,
    model: input.model,
    maxTurns: input.maxTurns,
    systemPrompt,
    input: input.input,
    storeRequests: input.storeRequests !== false,
  };
  return [
    { dest: 'task/prompt.md', content: `${input.input}\n` },
    { dest: '.agent/spec.json', content: JSON.stringify(spec, null, 2) },
  ];
}
