import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySessionsRepo, InMemorySessionEventsRepo, InMemoryAgentBus, InMemoryAgentRunsRepo } from '@remote-sandbox-agents/persistence';
import { SandboxManager, LocalSnapshotStore, SANDBOX_PHASE_TO_ATTEMPT_STATE, makeSessionState } from '@remote-sandbox-agents/sandbox';
import type {
  SandboxEventPayload, SnapshotStore, SandboxProvider, SandboxSession, SandboxSessionState, StreamHandle, JsonValue, Manifest,
} from '@remote-sandbox-agents/sandbox';
import { FakeSandboxProvider } from '@remote-sandbox-agents/sandbox/testing';
import type { AgentEngine, AgentSpec, WorkerProfile } from '@remote-sandbox-agents/contracts';
import { WorkerScheduler, type WorkerSchedulerOptions } from './worker-scheduler.js';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, PassThrough } from 'node:stream';

/**
 * A provider that mints docker-typed sessions (state.type === 'docker') with a
 * spawnStream + exec log, to exercise the docker-only branches of runInSandbox
 * (launcher seam + AGENT_HOME bootstrap) without a real container.
 */
class DockerLikeSession implements SandboxSession {
  execLog: Array<string | string[]> = [];
  constructor(readonly state: SandboxSessionState, private readonly commitExitCode = 0) {}
  async start(): Promise<void> {}
  async exec(cmd: string | string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.execLog.push(cmd);
    // `git commit` returns non-zero when there is nothing to commit; let tests drive that.
    const isCommit = Array.isArray(cmd) && cmd.includes('commit');
    return { exitCode: isCommit ? this.commitExitCode : 0, stdout: '', stderr: '' };
  }
  async read(): Promise<Readable> { return Readable.from(['']); }
  async write(): Promise<void> {}
  async persistWorkspace(): Promise<Readable> { return Readable.from(['TAR']); }
  async stop(): Promise<void> {}
  spawnStream(): StreamHandle {
    return { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {}, exitCode: Promise.resolve(0) };
  }
}

class DockerLikeFakeProvider implements SandboxProvider {
  readonly backendId = 'fake';
  created: DockerLikeSession[] = [];
  destroyed: DockerLikeSession[] = [];
  private n = 0;
  constructor(private readonly cfg: { type?: string; commitExitCode?: number } = {}) {}
  async create(): Promise<SandboxSession> {
    const id = `dk-${++this.n}`;
    const s = new DockerLikeSession(
      makeSessionState(this.cfg.type ?? 'docker', id, '/workspace', { container: { id } }),
      this.cfg.commitExitCode ?? 0,
    );
    this.created.push(s);
    return s;
  }
  async resume(state: SandboxSessionState): Promise<SandboxSession> { return new DockerLikeSession(state); }
  async destroy(session: SandboxSession): Promise<void> { this.destroyed.push(session as DockerLikeSession); }
  serializeState(state: SandboxSessionState): JsonValue { return JSON.parse(JSON.stringify(state)) as JsonValue; }
  deserializeState(payload: unknown): SandboxSessionState { return payload as SandboxSessionState; }
}

class ArtifactListingSession implements SandboxSession {
  readonly files = new Map<string, string>();
  readonly execLog: Array<string | string[]> = [];
  readonly state = makeSessionState('fake', 'artifact-session', '/workspace', {});
  isolatedRuns = 0;
  runIsolatedAgent?: () => Promise<void>;

  constructor(isolated = true) {
    if (!isolated) return;
    this.runIsolatedAgent = async () => {
      this.isolatedRuns += 1;
      this.seedArtifactFiles();
    };
  }

  seedArtifactFiles(): void {
    this.files.set('artifacts/summary.md', 'artifacts done');
    this.files.set('artifacts/paper.md', '# Paper\n');
    this.files.set('artifacts/notes.txt', 'notes');
    this.files.set('.agent/artifacts.json', JSON.stringify({
      artifacts: [
        { path: 'artifacts/paper.md', title: 'Paper', primary: true },
        { path: 'artifacts/missing.md', title: 'Missing' },
        { path: '../secrets.txt', title: 'Bad path' },
      ],
    }));
  }

  async start(): Promise<void> {}
  async exec(cmd: string | string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.execLog.push(cmd);
    const argv = Array.isArray(cmd) ? cmd : [cmd];
    if (argv[0] === 'sh' && argv[1] === '-c' && argv[2] === 'find artifacts -type f 2>/dev/null') {
      return {
        exitCode: 0,
        stdout: 'artifacts/summary.md\nartifacts/paper.md\nartifacts/notes.txt\n',
        stderr: '',
      };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async read(filePath: string): Promise<Readable> {
    if (!this.files.has(filePath)) throw new Error(`missing file ${filePath}`);
    return Readable.from([this.files.get(filePath)!]);
  }
  async write(filePath: string, data: Readable | Buffer | string): Promise<void> {
    this.files.set(filePath, typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : '');
  }
  async persistWorkspace(): Promise<Readable> { return Readable.from(['TAR']); }
  async stop(): Promise<void> {}
}

/** Same files as ArtifactListingSession, but no `runIsolatedAgent` — the live Docker path. */
class EnginePathArtifactSession extends ArtifactListingSession {
  constructor() {
    super(false);
    this.seedArtifactFiles();
  }
}

class EnginePathArtifactProvider implements SandboxProvider {
  readonly backendId = 'fake';
  created: EnginePathArtifactSession[] = [];
  destroyed: EnginePathArtifactSession[] = [];

  async create(): Promise<SandboxSession> {
    const session = new EnginePathArtifactSession();
    this.created.push(session);
    return session;
  }
  async resume(state: SandboxSessionState): Promise<SandboxSession> {
    return new EnginePathArtifactSession();
  }
  async destroy(session: SandboxSession): Promise<void> {
    this.destroyed.push(session as EnginePathArtifactSession);
  }
  serializeState(state: SandboxSessionState): JsonValue { return JSON.parse(JSON.stringify(state)) as JsonValue; }
  deserializeState(payload: unknown): SandboxSessionState { return payload as SandboxSessionState; }
}

class ArtifactListingProvider implements SandboxProvider {
  readonly backendId = 'fake';
  created: ArtifactListingSession[] = [];
  destroyed: ArtifactListingSession[] = [];

  async create(): Promise<SandboxSession> {
    const session = new ArtifactListingSession();
    this.created.push(session);
    return session;
  }
  async resume(state: SandboxSessionState): Promise<SandboxSession> {
    return new ArtifactListingSession();
  }
  async destroy(session: SandboxSession): Promise<void> {
    this.destroyed.push(session as ArtifactListingSession);
  }
  serializeState(state: SandboxSessionState): JsonValue { return JSON.parse(JSON.stringify(state)) as JsonValue; }
  deserializeState(payload: unknown): SandboxSessionState { return payload as SandboxSessionState; }
}

const failEngine: AgentEngine = {
  kind: 'pi-agent',
  async runTurn() { return { toolCalls: [], finishReason: 'error', errorMessage: 'engine boom' }; },
};

/** A manifest whose only mountable entry is a git_mount at dest `repo`. */
const gitMountManifest = {
  version: 1 as const, root: '/workspace', env: {},
  entries: {
    repo: { type: 'git_mount', provider: 'local', repo: '/m', baseRef: 'main', dest: 'repo', workingBranch: 'agent/x' },
  },
};

/**
 * Pull the harness's own git argv (add/commit) out of a session exec log,
 * ignoring the git_mount's clone/checkout/capture commands.
 */
function harnessGitCommands(execLog: Array<string | string[]>): string[][] {
  return execLog.filter(
    (c): c is string[] =>
      Array.isArray(c)
      && c[0] === 'git'
      && (
        c.includes('add')
        || c.includes('commit')
        || (c.includes('branch') && c.includes('-f'))
        || (c.includes('checkout') && !c.includes('-b'))
      ),
  );
}

function workerProfile(runtime: WorkerProfile['runtime']): WorkerProfile {
  return {
    id: 'coding-default', runtime, engine: 'pi-agent',
    modelDefaults: { model: 'gpt-5', sandbox: 'workspace-write', approvalPolicy: 'never' },
    toolsets: [], skills: { mode: 'all' }, approvalPolicy: 'never',
    limits: { maxRuntimeMinutes: 30, maxToolCalls: 200 }, workspaceRetention: 'delete-on-success',
  };
}

const stubSpec: AgentSpec = {
  id: 'coding-default', actor: 'worker', engine: { kind: 'pi-agent' },
  prompt: { assemble: async () => ({ system: 's', cacheBreakpoints: [], hash: '' }) },
  tools: { list: () => [], invoke: async () => ({ success: true, output: '' }) },
  skills: { index: async () => [], read: async () => ({ name: '', content: '', frontmatter: {} }), readFile: async () => '' },
  workspace: { kind: 'local', prepare: async () => ({ path: '/fake/ws-1', cleanupHints: { retention: 'delete-on-success' }, metadata: {} }), cleanup: async () => {} },
  secrets: { resolve: async () => [] } as never,
  fs: { mode: 'scoped', root: '/fake/ws-1' },
  policies: { approvalPolicy: 'never', maxTurns: 1, turnTimeoutMs: 1000, maxToolCalls: 10, maxRuntimeMinutes: 5 },
  metadata: {},
};

const okEngine: AgentEngine = {
  kind: 'pi-agent',
  async runTurn() { return { toolCalls: [], finalMessage: 'done', finishReason: 'completed' }; },
};

interface SetupOpts {
  snapshotStore?: SnapshotStore;
  provider?: SandboxProvider & { created: SandboxSession[]; destroyed: SandboxSession[] };
  resolveEngine?: WorkerSchedulerOptions['resolveEngine'];
  manifest?: Manifest;
}

async function setup(runtime: WorkerProfile['runtime'], opts: SetupOpts = {}) {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const agentRuns = new InMemoryAgentRunsRepo();
  await sessions.create({ id: 'parent', actor: 'orchestrator', parentSessionId: null, status: 'open', channelOrigin: null, agentSpecId: 'orch', metadata: {} });
  await sessions.create({ id: 'child', actor: 'worker', parentSessionId: 'parent', status: 'routing', channelOrigin: null, agentSpecId: 'coding-default', metadata: { goal: 'fix' } });

  const fake = opts.provider ?? new FakeSandboxProvider();
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const snapshotStore = opts.snapshotStore ?? new LocalSnapshotStore({ root: snapRoot });
  const manager = new SandboxManager({ providers: [fake], snapshotStore, clock: () => '2026-06-05T00:00:00.000Z' });

  const scheduler = new WorkerScheduler({
    sessions, bus, agentRuns,
    workspaceManager: { create: async () => { throw new Error('legacy path must NOT run for sandbox'); } } as never,
    resolveSpec: async () => stubSpec,
    resolveEngine: opts.resolveEngine ?? (() => okEngine),
    sandboxManager: manager,
    resolveProfile: async () => workerProfile(runtime),
    resolveProviderOptionsFor: () => ({ type: 'fake' }),
    buildManifestFor: () => (opts.manifest ?? { version: 1, root: '/workspace', entries: {}, env: {} }) as never,
  });
  return { sessions, events, scheduler, fake, agentRuns };
}

test('sandbox runtime: creates a session, snapshots, then destroys it', async () => {
  const { events, scheduler, fake } = await setup('sandbox-unix-local');
  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'succeeded');
  assert.equal(fake.created.length, 1, 'one session created');
  assert.equal(fake.destroyed.length, 1, 'session destroyed');
  const childEnd = (await events.list('child')).find((e) => e.kind === 'worker_end');
  assert.ok(childEnd, 'worker_end emitted');
  const parentDone = (await events.list('parent')).find((e) => e.kind === 'child_session_completed');
  const payload = parentDone!.payload as { snapshotRef?: { location: string } };
  assert.ok(payload.snapshotRef?.location, 'snapshot ref surfaced to parent');
});

test('backend-routing guard: provider is selected via options.type, not hardcoded', async () => {
  // A 'sandbox-docker' profile must route through the manager by options.type. We register the
  // fake provider under type 'fake' and map docker->fake to prove the scheduler is backend-generic.
  const { scheduler, fake } = await setup('sandbox-docker');
  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'succeeded');
  assert.equal(fake.created.length, 1, 'routed to a provider purely via options.type');
});

test('sandbox runtime: emits sandbox.* lifecycle events on the worker session in order', async () => {
  const { events, scheduler } = await setup('sandbox-unix-local');
  await scheduler.claimAndRun();

  const systemEvents = (await events.list('child')).filter(
    (e) => e.eventType === 'system' && e.kind.startsWith('sandbox.'),
  );
  assert.deepEqual(
    systemEvents.map((e) => e.kind),
    [
      'sandbox.container.creating',
      'sandbox.container.created',
      'sandbox.manifest.materializing',
      'sandbox.manifest.materialized',
      'sandbox.container.started',
      'sandbox.snapshot.persisting',
      'sandbox.snapshot.persisted',
      'sandbox.container.stopping',
      'sandbox.container.destroyed',
    ],
    'sandbox lifecycle events land on the worker session in lifecycle order',
  );
});

test('sandbox runtime: attemptState progresses on the worker session metadata', async () => {
  const { sessions, events, scheduler, agentRuns } = await setup('sandbox-unix-local');
  await scheduler.claimAndRun();

  // Final terminal attempt state after destroy.
  const child = await sessions.findById('child');
  assert.equal((child!.metadata as { attemptState?: string }).attemptState, 'succeeded');

  // agent_runs ledger: one row, fully populated, terminal status.
  const runs = await agentRuns.listForSession('child');
  assert.equal(runs.length, 1, 'expected exactly one agent_runs row per attempt');
  const row = runs[0]!;
  assert.equal(row.sessionId, 'child');
  assert.equal(row.attemptNumber, 1);
  assert.equal(row.status, 'succeeded');
  assert.equal(row.agentSpecId, 'coding-default');
  // markSandboxReady ran (sink saw `created` phase and patched the row).
  assert.equal(typeof row.sandboxSessionId, 'string');
  assert.equal(row.backend, 'fake'); // FakeSandboxProvider's backendId
  assert.equal(row.guestImage?.digest, 'sha256:fake');
  assert.equal(row.guestImage?.engine, 'pi-agent');
  // finalize ran with terminal fields.
  assert.equal(row.endedAt !== null, true);
  assert.equal(row.durationMs !== null, true);
  assert.equal(row.snapshotRef !== null, true);
  assert.equal(row.error, null);

  // Distinct ordered projection through the phase->attempt-state map.
  const systemEvents = (await events.list('child')).filter(
    (e) => e.eventType === 'system' && e.kind.startsWith('sandbox.'),
  );
  const states = systemEvents.map(
    (e) => SANDBOX_PHASE_TO_ATTEMPT_STATE[(e.payload as SandboxEventPayload).phase],
  );
  const distinct = states.filter((s, i) => s !== states[i - 1]);
  assert.deepEqual(distinct, ['starting_sandbox', 'snapshotting', 'succeeded']);
});

test('sandbox runtime: snapshot failure publishes sandbox.snapshot.failed and the run still completes', async () => {
  const failingStore: SnapshotStore = {
    storeType: 'failing',
    persist: async () => { throw new Error('disk full'); },
    restorable: async () => false,
    restore: async () => { throw new Error('n/a'); },
    readIndex: async () => { throw new Error('n/a'); },
    listFiles: async () => [],
    readFile: async () => { throw new Error('n/a'); },
  };
  const { events, scheduler, fake } = await setup('sandbox-unix-local', { snapshotStore: failingStore });
  const result = await scheduler.claimAndRun();

  assert.equal(result?.status, 'succeeded', 'engine turn succeeded; a snapshot failure does not fail the run');
  assert.equal(fake.destroyed.length, 1, 'session still destroyed despite snapshot failure');
  const failed = (await events.list('child')).find((e) => e.kind === 'sandbox.snapshot.failed');
  assert.ok(failed, 'sandbox.snapshot.failed event published so the failure is observable');
});

test('launcher seam: resolveEngine receives the live sandbox session', async () => {
  let receivedSession: SandboxSession | undefined;
  const provider = new DockerLikeFakeProvider();
  const { scheduler } = await setup('sandbox-docker', {
    provider,
    resolveEngine: (_spec, sandboxSession) => {
      receivedSession = sandboxSession;
      return okEngine;
    },
  });
  await scheduler.claimAndRun();
  assert.ok(receivedSession, 'resolveEngine was given a sandbox session');
  assert.equal(receivedSession, provider.created[0], 'it is the live session that was created for this run');
  assert.equal(receivedSession!.state.type, 'docker');
});

test('docker runtime: bootstraps AGENT_HOME in-container before the engine runs', async () => {
  const provider = new DockerLikeFakeProvider();
  const { scheduler } = await setup('sandbox-docker', { provider });
  await scheduler.claimAndRun();
  const session = provider.created[0]!;
  assert.deepEqual(session.execLog[0], ['mkdir', '-p', '/workspace/.agent'],
    'guest engine requires AGENT_HOME to pre-exist in the container');
});

test('non-docker runtime: does not run the in-container AGENT_HOME bootstrap', async () => {
  const { scheduler, fake } = await setup('sandbox-unix-local');
  await scheduler.claimAndRun();
  // FakeSandboxProvider sessions are type 'fake' (not 'docker'); no mkdir exec.
  const session = (fake as unknown as { created: Array<{ execLog: Array<string | string[]> }> }).created[0]!;
  const mkdirAgentHome = session.execLog.filter((c) =>
    Array.isArray(c) && c[0] === 'mkdir' && c.some((arg) => String(arg).includes('.agent')),
  );
  assert.equal(mkdirAgentHome.length, 0, 'unix-local must not run the docker-only bootstrap');
});

test('harness commit: stages and commits the working tree on a successful run', async () => {
  const provider = new DockerLikeFakeProvider({ type: 'unix_local' }); // backend-agnostic
  const { events, scheduler } = await setup('sandbox-unix-local', { provider, manifest: gitMountManifest as Manifest });
  await scheduler.claimAndRun();

  const git = harnessGitCommands(provider.created[0]!.execLog);
  assert.deepEqual(git[0], ['git', '-C', 'repo', 'branch', '-f', 'agent/x', 'HEAD'], 'aligns harness branch first');
  assert.deepEqual(git[1], ['git', '-C', 'repo', 'checkout', 'agent/x']);
  assert.deepEqual(git[2], ['git', '-C', 'repo', 'add', '-A'], 'stages everything');
  assert.equal(git[3]?.[0], 'git');
  assert.ok(git[3]?.includes('commit'), 'then commits');
  assert.ok(git[3]?.includes('--no-gpg-sign'));
  assert.ok(git[3]?.includes('user.email=agent@remote-sandbox-agents'), 'harness identity, not the model');

  const commitEvent = (await events.list('child')).find((e) => e.kind === 'sandbox.harness_commit');
  assert.ok(commitEvent, 'sandbox.harness_commit emitted');
  assert.equal((commitEvent!.payload as { detail: { committed: boolean } }).detail.committed, true);
});

test('harness commit: not attempted on a failed turn', async () => {
  const provider = new DockerLikeFakeProvider({ type: 'unix_local' });
  const { scheduler } = await setup('sandbox-unix-local', {
    provider, manifest: gitMountManifest as Manifest, resolveEngine: () => failEngine,
  });
  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'failed');
  assert.equal(harnessGitCommands(provider.created[0]!.execLog).length, 0, 'no commit on a failed run');
});

test('harness commit: tolerates "nothing to commit" (exit 1) as a no-diff, not a failure', async () => {
  const provider = new DockerLikeFakeProvider({ type: 'unix_local', commitExitCode: 1 });
  const { events, scheduler } = await setup('sandbox-unix-local', { provider, manifest: gitMountManifest as Manifest });
  const result = await scheduler.claimAndRun();

  assert.equal(result?.status, 'succeeded', 'an empty diff is not a worker failure');
  const commitEvent = (await events.list('child')).find((e) => e.kind === 'sandbox.harness_commit');
  assert.equal((commitEvent!.payload as { detail: { committed: boolean; message: string } }).detail.committed, false);
  assert.equal((commitEvent!.payload as { detail: { message: string } }).detail.message, 'nothing-to-commit');
});

test('harness commit: skipped when the manifest declares no git mount', async () => {
  const provider = new DockerLikeFakeProvider({ type: 'unix_local' });
  const { scheduler } = await setup('sandbox-unix-local', { provider }); // default empty-entries manifest
  await scheduler.claimAndRun();
  assert.equal(harnessGitCommands(provider.created[0]!.execLog).length, 0, 'no git mount => no harness commit');
});

test('sandbox runtime: persists lastSnapshotRef on session metadata after completion', async () => {
  const { sessions, scheduler } = await setup('sandbox-unix-local');
  await scheduler.claimAndRun();
  const child = await sessions.findById('child');
  assert.ok(child?.metadata.lastSnapshotRef, 'lastSnapshotRef stamped on session');
});

test('sandbox runtime: invokes hydrateWorkspace when resumeSnapshotRef is set', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const snapRef = { id: 'snap-1', location: '/tmp/snap-1' };
  await sessions.create({
    id: 'child', actor: 'worker', parentSessionId: null, status: 'routing',
    channelOrigin: 'board:v1:p:t', agentSpecId: 'coding-default',
    metadata: { goal: 'fix', resumeSnapshotRef: snapRef },
  });
  const fake = new FakeSandboxProvider();
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const snapshotStore = new LocalSnapshotStore({ root: snapRoot });
  const manager = new SandboxManager({ providers: [fake], snapshotStore, clock: () => '2026-06-05T00:00:00.000Z' });
  const hydrated: Array<{ ref: unknown }> = [];
  const scheduler = new WorkerScheduler({
    sessions, bus,
    workspaceManager: { create: async () => { throw new Error('legacy'); } } as never,
    resolveSpec: async () => stubSpec,
    resolveEngine: () => okEngine,
    sandboxManager: manager,
    resolveProfile: async () => workerProfile('sandbox-unix-local'),
    resolveProviderOptionsFor: () => ({ type: 'fake' }),
    buildManifestFor: () => ({ version: 1, root: '/workspace', entries: {}, env: {} }) as never,
    hydrateWorkspace: async (_session, _sandbox, ref) => { hydrated.push({ ref }); },
  });
  await scheduler.claimAndRun();
  assert.equal(hydrated.length, 1);
  assert.deepEqual(hydrated[0]!.ref, snapRef);
  const after = await sessions.findById('child');
  assert.equal(after?.metadata.resumeSnapshotRef, null, 'one-shot flag cleared');
});

test('unix_local path runs isolated agent and does not start the host engine', async () => {
  const fake = new FakeSandboxProvider();
  fake.isolatedAgent = true;
  let engineCalls = 0;
  const { scheduler } = await setup('sandbox-docker', {
    provider: fake,
    resolveEngine: () => {
      engineCalls += 1;
      throw new Error('host engine must not run for remote guest');
    },
  });
  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'succeeded');
  assert.equal(engineCalls, 0);
  assert.equal(fake.created[0]?.isolatedRuns, 1);
});

test('isolated agent artifacts are resolved and persisted on finalize and completion', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const agentRuns = new InMemoryAgentRunsRepo();
  await sessions.create({ id: 'parent', actor: 'orchestrator', parentSessionId: null, status: 'open', channelOrigin: null, agentSpecId: 'orch', metadata: {} });
  await sessions.create({ id: 'child', actor: 'worker', parentSessionId: 'parent', status: 'routing', channelOrigin: 'board:v1:proj:task-1', agentSpecId: 'author', metadata: { goal: 'write paper' } });

  const provider = new ArtifactListingProvider();
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const snapshotStore = new LocalSnapshotStore({ root: snapRoot });
  const manager = new SandboxManager({ providers: [provider], snapshotStore, clock: () => '2026-06-05T00:00:00.000Z' });
  const completions: Array<{ artifacts?: unknown; artifactDrops?: unknown }> = [];

  const scheduler = new WorkerScheduler({
    sessions,
    bus,
    agentRuns,
    workspaceManager: { create: async () => { throw new Error('legacy path must NOT run for sandbox'); } } as never,
    resolveSpec: async () => stubSpec,
    resolveEngine: () => {
      throw new Error('host engine must not run for isolated agent');
    },
    sandboxManager: manager,
    resolveProfile: async () => workerProfile('sandbox-docker'),
    resolveProviderOptionsFor: () => ({ type: 'fake' }),
    buildManifestFor: () => ({ version: 1, root: '/workspace', entries: {}, env: {} }) as never,
    onWorkerComplete: (_session, result) => {
      completions.push({ artifacts: result.artifacts, artifactDrops: result.artifactDrops });
    },
  });

  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'succeeded');

  const run = (await agentRuns.listForSession('child'))[0];
  assert.deepEqual(run?.artifacts, [
    { path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true },
  ]);
  assert.deepEqual(completions, [{
    artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true }],
    artifactDrops: [
      { path: 'artifacts/missing.md', reason: 'missing' },
      { path: '../secrets.txt', reason: 'not_under_artifacts' },
    ],
  }]);
});

test('docker engine-adapter path resolves artifacts from the collected sidecar', async () => {
  const sessions = new InMemorySessionsRepo();
  const events = new InMemorySessionEventsRepo();
  const bus = new InMemoryAgentBus(events);
  const agentRuns = new InMemoryAgentRunsRepo();
  await sessions.create({ id: 'parent', actor: 'orchestrator', parentSessionId: null, status: 'open', channelOrigin: null, agentSpecId: 'orch', metadata: {} });
  await sessions.create({ id: 'child', actor: 'worker', parentSessionId: 'parent', status: 'routing', channelOrigin: 'board:v1:proj:task-1', agentSpecId: 'author', metadata: { goal: 'write paper' } });

  const provider = new EnginePathArtifactProvider();
  const snapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
  const snapshotStore = new LocalSnapshotStore({ root: snapRoot });
  const manager = new SandboxManager({ providers: [provider], snapshotStore, clock: () => '2026-06-05T00:00:00.000Z' });
  const completions: Array<{ artifacts?: unknown; artifactDrops?: unknown }> = [];

  const scheduler = new WorkerScheduler({
    sessions,
    bus,
    agentRuns,
    workspaceManager: { create: async () => { throw new Error('legacy path must NOT run for sandbox'); } } as never,
    resolveSpec: async () => stubSpec,
    resolveEngine: () => ({
      kind: 'pi-agent',
      async runTurn() {
        return {
          toolCalls: [],
          finishReason: 'completed' as const,
          finalMessage: 'wrote paper',
          artifacts: {
            artifacts: [
              { path: 'artifacts/paper.md', title: 'Paper', primary: true },
              { path: 'artifacts/missing.md', title: 'Missing' },
              { path: '../secrets.txt', title: 'Bad path' },
            ],
          },
        };
      },
    }),
    sandboxManager: manager,
    resolveProfile: async () => workerProfile('sandbox-docker'),
    resolveProviderOptionsFor: () => ({ type: 'fake' }),
    buildManifestFor: () => ({ version: 1, root: '/workspace', entries: {}, env: {} }) as never,
    onWorkerComplete: (_session, result) => {
      completions.push({ artifacts: result.artifacts, artifactDrops: result.artifactDrops });
    },
  });

  const result = await scheduler.claimAndRun();
  assert.equal(result?.status, 'succeeded');
  assert.equal(provider.created[0]?.isolatedRuns, 0);

  const run = (await agentRuns.listForSession('child'))[0];
  assert.deepEqual(run?.artifacts, [
    { path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true },
  ]);
  assert.deepEqual(completions, [{
    artifacts: [{ path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true }],
    artifactDrops: [
      { path: 'artifacts/missing.md', reason: 'missing' },
      { path: '../secrets.txt', reason: 'not_under_artifacts' },
    ],
  }]);
});
