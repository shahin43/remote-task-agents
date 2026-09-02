import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostgresSslMode, resolvePostgresSslConfig } from './connection.js';

test('parsePostgresSslMode: returns null when sslmode is not set', () => {
  assert.equal(parsePostgresSslMode('postgres://u@h:5432/db'), null);
});

test('parsePostgresSslMode: recognizes the six libpq modes', () => {
  for (const mode of ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']) {
    assert.equal(parsePostgresSslMode(`postgres://u@h/db?sslmode=${mode}`), mode);
  }
});

test('parsePostgresSslMode: ignores unknown modes (defensive against typos)', () => {
  assert.equal(parsePostgresSslMode('postgres://u@h/db?sslmode=tls'), null);
});

test('parsePostgresSslMode: returns null on an unparseable URL', () => {
  assert.equal(parsePostgresSslMode('not a url'), null);
});

test('resolvePostgresSslConfig: plaintext modes resolve to false', () => {
  assert.equal(resolvePostgresSslConfig(null), false);
  for (const m of ['disable', 'allow', 'prefer']) {
    assert.equal(resolvePostgresSslConfig(m), false);
  }
});

test('resolvePostgresSslConfig: require defaults to rejectUnauthorized=false (libpq parity)', () => {
  const cfg = resolvePostgresSslConfig('require');
  assert.deepEqual(cfg, { rejectUnauthorized: false });
});

test('resolvePostgresSslConfig: verify-ca defaults to rejectUnauthorized=true', () => {
  const cfg = resolvePostgresSslConfig('verify-ca');
  assert.deepEqual(cfg, { rejectUnauthorized: true });
});

test('resolvePostgresSslConfig: verify-full defaults to rejectUnauthorized=true', () => {
  const cfg = resolvePostgresSslConfig('verify-full');
  assert.deepEqual(cfg, { rejectUnauthorized: true });
});

test('resolvePostgresSslConfig: override forces rejectUnauthorized regardless of mode', () => {
  assert.deepEqual(
    resolvePostgresSslConfig('require', { rejectUnauthorizedOverride: 'true' }),
    { rejectUnauthorized: true },
  );
  assert.deepEqual(
    resolvePostgresSslConfig('verify-full', { rejectUnauthorizedOverride: 'false' }),
    { rejectUnauthorized: false },
  );
});

test('resolvePostgresSslConfig: loads CA bundle when caPath is set', () => {
  const cfg = resolvePostgresSslConfig(
    'verify-full',
    { caPath: '/etc/postgres/ca.pem' },
    (p) => (p === '/etc/postgres/ca.pem' ? '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n' : 'unused'),
  );
  assert.equal((cfg as { ca?: string }).ca, '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n');
  assert.equal((cfg as { rejectUnauthorized: boolean }).rejectUnauthorized, true);
});
