import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './cli-args.js';

const identity = (p: string): string => p;
const emptyEnv: Record<string, string | undefined> = {};

function parse(argv: string[], env: Record<string, string | undefined> = emptyEnv) {
  return parseArgs(argv, { env, resolvePath: identity });
}

test('parseArgs: defaults to api role with HTTP-only behavior', () => {
  const args = parse([]);
  assert.equal(args.role, 'api');
  assert.equal(args.withWorker, false, 'api role must NOT embed worker drain by default');
});

test('parseArgs: accepts --role api', () => {
  const args = parse(['--role', 'api']);
  assert.equal(args.role, 'api');
  assert.equal(args.withWorker, false);
});

test('parseArgs: accepts --role control', () => {
  const args = parse(['--role', 'control']);
  assert.equal(args.role, 'control');
  assert.equal(args.withWorker, false);
});

test('parseArgs: accepts --role reconciler', () => {
  const args = parse(['--role', 'reconciler']);
  assert.equal(args.role, 'reconciler');
});


test('parseArgs: accepts --role api --with-worker for local dev', () => {
  const args = parse(['--role', 'api', '--with-worker']);
  assert.equal(args.role, 'api');
  assert.equal(args.withWorker, true);
});

test('parseArgs: rejects --role worker --with-worker', () => {
  assert.throws(
    () => parse(['--role', 'worker', '--with-worker']),
    /--with-worker is only valid with --role api/,
  );
});

test('parseArgs: rejects --role control --with-worker', () => {
  assert.throws(
    () => parse(['--role', 'control', '--with-worker']),
    /--with-worker is only valid with --role api/,
  );
});

test('parseArgs: rejects --role api --worker-concurrency without --with-worker', () => {
  assert.throws(
    () => parse(['--role', 'api', '--worker-concurrency', '4']),
    /--worker-concurrency is only valid with --role worker/,
  );
});

test('parseArgs: accepts --role api --with-worker --worker-concurrency N', () => {
  const args = parse(['--role', 'api', '--with-worker', '--worker-concurrency', '3']);
  assert.equal(args.workerConcurrency, 3);
});

test('parseArgs: accepts --role worker --worker-concurrency N', () => {
  const args = parse(['--role', 'worker', '--worker-concurrency', '5']);
  assert.equal(args.workerConcurrency, 5);
});

test('parseArgs: rejects unknown --role value', () => {
  assert.throws(
    () => parse(['--role', 'orchestrator']),
    /invalid --role value/,
  );
});

test('parseArgs: rejects unknown flag', () => {
  assert.throws(
    () => parse(['--made-up-flag']),
    /unknown CLI flag/,
  );
});

test('parseArgs: --control-id and --worker-id pass through', () => {
  const a = parse(['--role', 'control', '--control-id', 'control-A']);
  assert.equal(a.controlId, 'control-A');
  const b = parse(['--role', 'worker', '--worker-id', 'worker-7']);
  assert.equal(b.workerId, 'worker-7');
});

test('parseArgs: --poll-interval-ms parsed and shared between control and worker', () => {
  const a = parse(['--role', 'control', '--poll-interval-ms', '1500']);
  assert.equal(a.pollIntervalMs, 1500);
  const b = parse(['--role', 'worker', '--poll-interval-ms', '2500']);
  assert.equal(b.pollIntervalMs, 2500);
});

test('parseArgs: REMOTE_AGENT_ROLE env defaults the role', () => {
  const args = parseArgs([], { env: { REMOTE_AGENT_ROLE: 'control' }, resolvePath: identity });
  assert.equal(args.role, 'control');
});

test('parseArgs: REMOTE_AGENT_WITH_WORKER=true env enables embedded drain', () => {
  const args = parseArgs([], {
    env: { REMOTE_AGENT_ROLE: 'api', REMOTE_AGENT_WITH_WORKER: 'true' },
    resolvePath: identity,
  });
  assert.equal(args.role, 'api');
  assert.equal(args.withWorker, true);
});

test('parseArgs: REMOTE_AGENT_WITH_WORKER=true with non-api role is rejected', () => {
  assert.throws(
    () => parseArgs([], {
      env: { REMOTE_AGENT_ROLE: 'worker', REMOTE_AGENT_WITH_WORKER: 'true' },
      resolvePath: identity,
    }),
    /--with-worker is only valid with --role api/,
  );
});
