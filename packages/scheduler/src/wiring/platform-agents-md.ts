/**
 * Platform overlay prepended to every profile's AGENTS.md before it is
 * inlined at the sandbox workspace root. Artifact preview is a harness
 * concern, not a per-profile special case (coder/reviewer git diffs stay
 * on the Files tab; a harness diff viewer is later).
 */

export const PLATFORM_ARTIFACT_PREVIEW_SECTION = `## Deliverables for human preview

If this run produces files a human should read in the task drawer (papers, notes, charts, reports — not \`repo/\` edits and not scratch), write them under \`artifacts/\` and declare only those paths in \`.agent/artifacts.json\` before \`handoff\`. The top-level key must be exactly \`artifacts\` (not another name):

\`\`\`json
{
  "artifacts": [
    { "path": "artifacts/<file>", "title": "<human title>", "primary": true }
  ]
}
\`\`\`

Paths must exist under \`artifacts/\`. Omit the sidecar when there are no preview deliverables (for example a coding change that only edits \`repo/\`).

`;

export function composeWorkspaceAgentsMd(profileAgentsMd: string): string {
  const profile = profileAgentsMd.trimEnd();
  if (profile.includes('## Deliverables for human preview')) return `${profile}\n`;
  return `${PLATFORM_ARTIFACT_PREVIEW_SECTION}${profile}\n`;
}
