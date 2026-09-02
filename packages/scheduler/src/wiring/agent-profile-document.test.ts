import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileValidationError, validateAndBuildProfileDocument } from './agent-profile-document.js';

test('validateAndBuildProfileDocument accepts a changelog-writer shaped profile', () => {
  const built = validateAndBuildProfileDocument({
    id: 'changelog-writer',
    skills: { names: ['business-paper'] },
    capabilities: ['filesystem', 'shell', 'handoff'],
  });
  assert.equal(built.profileId, 'changelog-writer');
  assert.equal(built.document.engine, 'pi-agent');
  assert.deepEqual(built.document.skills?.names, ['business-paper']);
});

test('validateAndBuildProfileDocument rejects unknown engines', () => {
  assert.throws(
    () => validateAndBuildProfileDocument({ id: 'custom-bot', engine: 'nope' }),
    (err: unknown) => err instanceof ProfileValidationError,
  );
});
