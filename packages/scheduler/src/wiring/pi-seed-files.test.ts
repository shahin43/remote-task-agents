import assert from 'node:assert/strict';
import { test } from 'node:test';

import { piSeedEngineFiles, promptFromSessionMetadata } from './pi-seed-files.js';

test('promptFromSessionMetadata prefers the task brief', () => {
  assert.match(
    promptFromSessionMetadata({
      goal: 'ignore me',
      contextFiles: [{ path: 'context/task-brief.md', content: '# Task Brief\n\nWrite artifacts/paper.md\n' }],
    }),
    /paper/,
  );
});

test('piSeedEngineFiles writes spec + prompt with profile soul and pinned skills', () => {
  const files = piSeedEngineFiles({
    profileId: 'author',
    soul: 'You produce short papers.',
    basePrompt: 'Write deliverables under artifacts/.',
    skillIds: ['business-paper', 'chart'],
    input: 'Write artifacts/sandbox-agents.md. Do not query the warehouse.',
    provider: 'openai',
    model: 'gpt-5.4-mini',
    maxTurns: 24,
  });
  const specFile = files.find((f) => f.dest === '.agent/spec.json');
  const promptFile = files.find((f) => f.dest === 'task/prompt.md');
  assert.ok(specFile && promptFile);
  const spec = JSON.parse(specFile.content) as {
    profileId: string;
    systemPrompt: string;
    input: string;
  };
  assert.equal(spec.profileId, 'author');
  assert.match(spec.systemPrompt, /short papers/);
  assert.match(spec.systemPrompt, /artifacts/);
  assert.match(spec.input, /Do not query the warehouse/);
  assert.match(promptFile.content, /sandbox-agents/);
});
