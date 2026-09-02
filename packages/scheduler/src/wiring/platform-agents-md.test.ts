import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeWorkspaceAgentsMd, PLATFORM_ARTIFACT_PREVIEW_SECTION } from './platform-agents-md.js';

test('composeWorkspaceAgentsMd prepends the platform preview section to every profile', () => {
  const out = composeWorkspaceAgentsMd('# Coder\nWork in repo/.\n');
  assert.ok(out.startsWith('## Deliverables for human preview'));
  assert.match(out, /\.agent\/artifacts\.json/);
  assert.match(out, /# Coder/);
  assert.ok(out.includes(PLATFORM_ARTIFACT_PREVIEW_SECTION));
});

test('composeWorkspaceAgentsMd does not duplicate the section', () => {
  const once = composeWorkspaceAgentsMd('# Author');
  const twice = composeWorkspaceAgentsMd(once);
  assert.equal(twice.split('## Deliverables for human preview').length - 1, 1);
});
