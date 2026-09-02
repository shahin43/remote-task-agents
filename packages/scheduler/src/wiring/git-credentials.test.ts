import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskToken, resolveGitCredential, safeGitError, gitCloneUrl, gitAskPassEnv } from './git-credentials.js';

test('resolveGitCredential prefers configured env then fallbacks', () => {
  const prevRemote = process.env.REMOTE_AGENT_GIT_TOKEN;
  const prevGit = process.env.GIT_TOKEN;
  const prevCustom = process.env.CUSTOM_GIT_TOKEN;
  try {
    delete process.env.REMOTE_AGENT_GIT_TOKEN;
    delete process.env.GIT_TOKEN;
    process.env.CUSTOM_GIT_TOKEN = 'custom-token';
    assert.equal(resolveGitCredential('CUSTOM_GIT_TOKEN'), 'custom-token');
    process.env.REMOTE_AGENT_GIT_TOKEN = 'remote-token';
    assert.equal(resolveGitCredential('CUSTOM_GIT_TOKEN'), 'custom-token');
  } finally {
    if (prevRemote === undefined) delete process.env.REMOTE_AGENT_GIT_TOKEN;
    else process.env.REMOTE_AGENT_GIT_TOKEN = prevRemote;
    if (prevGit === undefined) delete process.env.GIT_TOKEN;
    else process.env.GIT_TOKEN = prevGit;
    if (prevCustom === undefined) delete process.env.CUSTOM_GIT_TOKEN;
    else process.env.CUSTOM_GIT_TOKEN = prevCustom;
  }
});

test('maskToken removes token substrings from error text', () => {
  const token = 'pat-secret-value-123';
  const masked = maskToken(`auth failed for ${token} on push`, token);
  assert.equal(masked, 'auth failed for *** on push');
});

test('safeGitError masks token in messages', () => {
  const token = 'super-secret';
  const out = safeGitError(`fatal: could not read Password for '${token}'`, token);
  assert.ok(!out.includes(token));
});

test('gitCloneUrl sets a username when the URL has none', () => {
  assert.equal(
    gitCloneUrl('https://git.example.com/org/sample.git'),
    'https://git@git.example.com/org/sample.git',
  );
});

test('gitAskPassEnv points git at the askpass helper', () => {
  const env = gitAskPassEnv('/tmp/askpass.sh');
  assert.equal(env.GIT_ASKPASS, '/tmp/askpass.sh');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});
