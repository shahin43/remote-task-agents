import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function serviceBlock(compose: string, name: string): string {
  const match = compose.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)\\n  [a-z]`));
  assert.ok(match, `docker-compose.yml must define a ${name} service`);
  return match[1]!;
}

test('compose API service receives snapshot store for promotion approve', () => {
  const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const api = serviceBlock(compose, 'api');
  assert.match(api, /REMOTE_AGENT_SNAPSHOT_STORE/);
});

test('compose worker service uses docker sandbox runtime', () => {
  const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const worker = serviceBlock(compose, 'worker');
  assert.match(worker, /REMOTE_AGENT_WORKER_RUNTIME/);
  assert.match(worker, /OPENAI_API_KEY/);
});

test('runtime image does not install a cloud CLI', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  assert.equal(/awscli/.test(dockerfile), false);
});
