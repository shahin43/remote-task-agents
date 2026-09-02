import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createManifest, parseManifest } from './manifest.js';

describe('Manifest', () => {
  it('createManifest applies defaults (version=1, root=/workspace)', () => {
    const m = createManifest({ entries: {}, env: {} });
    assert.equal(m.version, 1);
    assert.equal(m.root, '/workspace');
  });

  it('round-trips through JSON via parseManifest', () => {
    const m = createManifest({
      entries: {
        'repo/README.md': { type: 'local_file', src: '/tmp/README.md', dest: 'repo/README.md' },
        'data/': { type: 'local_dir', src: '/tmp/data', dest: 'data/' },
      },
      env: { FOO: 'bar' },
    });
    const json = JSON.parse(JSON.stringify(m));
    const parsed = parseManifest(json);
    assert.deepEqual(parsed, m);
  });

  it('parseManifest rejects an unknown entry type', () => {
    assert.throws(
      () => parseManifest({ version: 1, root: '/workspace', env: {}, entries: { x: { type: 'nope' } } }),
      /unknown entry type/,
    );
  });

  it('parseManifest rejects a non-workspace-relative dest (absolute path)', () => {
    assert.throws(
      () => parseManifest({
        version: 1, root: '/workspace', env: {},
        entries: { x: { type: 'local_file', src: '/tmp/a', dest: '/etc/passwd' } },
      }),
      /dest must be workspace-relative/,
    );
  });

  it('round-trips an inline_file entry (generated content, no host src)', () => {
    const m = createManifest({
      entries: { 'AGENTS.md': { type: 'inline_file', dest: 'AGENTS.md', content: '# Instructions\n' } },
      env: {},
    });
    const parsed = parseManifest(JSON.parse(JSON.stringify(m)));
    assert.deepEqual(parsed, m);
  });

  it('parseManifest rejects an inline_file with non-string content', () => {
    assert.throws(
      () => parseManifest({
        version: 1, root: '/workspace', env: {},
        entries: { x: { type: 'inline_file', dest: 'a.md', content: 42 } },
      }),
      /inline_file requires string content/,
    );
  });

  it('round-trips a workspace policy (writeAccess + runAs)', () => {
    const m = createManifest({
      entries: {},
      env: {},
      workspace: { writeAccess: 'rw', runAs: { uid: 1000, gid: 1000 } },
    });
    const parsed = parseManifest(JSON.parse(JSON.stringify(m)));
    assert.deepEqual(parsed.workspace, { writeAccess: 'rw', runAs: { uid: 1000, gid: 1000 } });
  });

  it('omits the workspace field by default (back-compat)', () => {
    const m = createManifest({ entries: {}, env: {} });
    assert.equal(m.workspace, undefined);
    const parsed = parseManifest(JSON.parse(JSON.stringify(m)));
    assert.equal(parsed.workspace, undefined);
  });

  it('parseManifest rejects an invalid writeAccess value', () => {
    assert.throws(
      () => parseManifest({
        version: 1, root: '/workspace', env: {}, entries: {},
        workspace: { writeAccess: 'rwx' },
      }),
      /writeAccess must be 'rw' or 'ro'/,
    );
  });

  it('parseManifest rejects a runAs with a negative uid', () => {
    assert.throws(
      () => parseManifest({
        version: 1, root: '/workspace', env: {}, entries: {},
        workspace: { runAs: { uid: -1, gid: 0 } },
      }),
      /runAs.uid must be a non-negative integer/,
    );
  });
});
