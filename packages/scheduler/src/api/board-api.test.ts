import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  InMemoryBoardStore,
  InMemorySessionsRepo,
  InMemorySessionEventsRepo,
  InMemoryAgentRunsRepo,
} from '@remote-sandbox-agents/persistence';
import { boardConversationKey } from '@remote-sandbox-agents/contracts';
import { BoardApiService, createBoardApiHandler, ApiError } from './board-api.js';
import { ProjectConfigRegistry } from '../wiring/project-config.js';
import { ensureBoardDevPrincipals } from '../wiring/ensure-board-principals.js';

const TENANT = 'tenant-1';
const PROJECT = 'proj-1';

function makeProjects() {
  return new ProjectConfigRegistry([{
    projectId: PROJECT,
    tenantId: TENANT,
    defaultRepos: ['sample/service'],
    repos: [
      { slug: 'sample/service', provider: 'local', baseBranch: 'main', dest: 'repo' },
      { slug: 'sample/shared-lib', provider: 'local', baseBranch: 'main', dest: 'shared-lib' },
    ],
  }]);
}

function makeService() {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const sessionEvents = new InMemorySessionEventsRepo();
  const service = new BoardApiService({
    board,
    sessions,
    sessionEvents,
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
  });
  return { board, sessions, sessionEvents, service };
}

async function seedPrincipals(board: InMemoryBoardStore) {
  await board.upsertUser({
    id: 'user-dev', tenantId: TENANT, projectId: PROJECT, kind: 'human',
    displayName: 'Dev operator', externalRefs: {},
  });
  await board.upsertAgent({
    id: 'agent-coder', tenantId: TENANT, projectId: PROJECT,
    profileId: 'pi-reviewer-default', displayName: 'Pi Reviewer',
  });
}

test('listAgents returns shipped board agents even if they were seeded under another project id', async () => {
  const { board, service } = makeService();
  await ensureBoardDevPrincipals({ board, tenantId: TENANT, projectId: 'other-project' });
  const agents = await service.listAgents();
  const ids = agents.map((a) => a.id).sort();
  assert.deepEqual(ids, ['agent-author', 'agent-coder', 'agent-reviewer']);
  assert.equal(agents.every((a) => a.kind === 'agent'), true);
});

test('createTask + listTasks maps the view model', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);

  const created = await service.createTask(
    { title: 'Fix the pipeline', description: 'Details', sessionName: 'coding workflow', assigneeId: null },
    'user-dev',
  );

  assert.equal(created.title, 'Fix the pipeline');
  assert.equal(created.description, 'Details');
  assert.equal(created.status, 'backlog');
  assert.equal(created.createdBy, 'user-dev');
  assert.equal(created.sessionName, 'coding workflow');
  assert.equal(created.workspaceKey, boardConversationKey(PROJECT, created.id));
  assert.ok(created.issueKey.length > 0);
  assert.deepEqual(created.tags, []);
  // The 'created' task_event surfaces in activity.
  assert.ok(created.activity.some((a) => a.eventType === 'task_created'));
  assert.deepEqual(created.repos, ['sample/service']);
  assert.equal(created.primaryRepo, 'sample/service');

  const list = await service.listTasks();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, created.id);
});

test('createTask stores selected repos in metadata', async () => {
  const { service } = makeService();
  const created = await service.createTask(
    { title: 'Shared only', repos: ['sample/shared-lib'], primaryRepo: 'sample/shared-lib' },
    'user-dev',
  );
  assert.deepEqual(created.repos, ['sample/shared-lib']);
  assert.equal(created.primaryRepo, 'sample/shared-lib');
});

test('listProjectRepos returns the project catalog', async () => {
  const { service } = makeService();
  const catalog = await service.listProjectRepos();
  assert.equal(catalog.length, 2);
  assert.ok(catalog.some((e) => e.slug === 'sample/shared-lib'));
});

test('assign to an agent without routeTask records intent only', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: 'agent-coder' }, 'user-dev');
  assert.equal(created.assignee?.id, 'agent-coder');
});

test('assign to an agent triggers routeTask when wired', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const routed: string[] = [];
  const routedService = new BoardApiService({
    board,
    sessions: new InMemorySessionsRepo(),
    sessionEvents: new InMemorySessionEventsRepo(),
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
    routeTask: async (taskId) => {
      routed.push(taskId);
      return { routed: true };
    },
  });
  const created = await routedService.createTask({ title: 'T', assigneeId: null }, 'user-dev');
  await routedService.updateTask(created.id, { assigneeId: 'agent-coder' }, 'user-dev');
  assert.deepEqual(routed, [created.id]);
});

test('assign to an agent + status change reflect in the view', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: null }, 'user-dev');

  const assigned = await service.updateTask(created.id, { assigneeId: 'agent-coder' }, 'user-dev');
  assert.ok(assigned);
  assert.equal(assigned!.assignee?.id, 'agent-coder');
  assert.equal(assigned!.assignee?.kind, 'agent');

  const moved = await service.updateTask(created.id, { status: 'working' }, 'user-dev');
  assert.equal(moved!.status, 'working');
  assert.ok(moved!.activity.some((a) => a.eventType === 'status_changed'));
});

test('invalid status is rejected', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: null }, 'user-dev');
  await assert.rejects(
    () => service.updateTask(created.id, { status: 'nonsense' as never }, 'user-dev'),
    /invalid status/,
  );
});

test('addComment surfaces a comment with resolved author', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: null }, 'user-dev');

  const commented = await service.addComment(created.id, 'Looks good', 'user-dev');
  assert.equal(commented!.comments.length, 1);
  assert.equal(commented!.comments[0]!.bodyMarkdown, 'Looks good');
  assert.equal(commented!.comments[0]!.author?.displayName, 'Dev operator');
});

test('progress + runs link a board task to its worker session events', async () => {
  const { board, sessions, sessionEvents, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: 'agent-coder' }, 'user-dev');

  const channelOrigin = boardConversationKey(PROJECT, created.id);
  const session = await sessions.create({
    id: 'sess-1', actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin, agentSpecId: 'coding-default', metadata: { runtime: 'sandbox-docker' },
  });
  await sessionEvents.append({ sessionId: session.id, eventType: 'turn', kind: 'assistant_message', payload: { text: 'working on it' } });

  const progress = await service.taskProgress(created.id);
  assert.ok(progress);
  assert.equal(progress!.run?.status, 'running');
  assert.equal(progress!.run?.workspaceBackend, 'sandbox-docker');
  assert.equal(progress!.events.length, 1);
  assert.equal(progress!.events[0]!.body, 'working on it');

  // The session also shows up as a run on the task view.
  const view = await service.getTask(created.id);
  assert.equal(view!.runs.length, 1);
  assert.equal(view!.runs[0]!.id, 'sess-1');
});

test('listSessions parses the board task id from channel origin', async () => {
  const { board, sessions, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: null }, 'user-dev');
  await sessions.create({
    id: 'sess-1', actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin: boardConversationKey(PROJECT, created.id), agentSpecId: 'coding-default', metadata: {},
  });

  const list = await service.listSessions();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.taskId, created.id);
  assert.equal(list[0]!.actor, 'worker');
});

test('listSessions excludes legacy Linear channel origins', async () => {
  const { sessions, service } = makeService();
  await sessions.create({
    id: 'linear-sess', actor: 'worker', parentSessionId: null, status: 'succeeded',
    channelOrigin: 'linear:AGE-10', agentSpecId: 'coding-default', metadata: {},
  });

  assert.equal((await service.listSessions()).length, 0);
});

// --- HTTP adapter ---

function mockResponse() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      this.statusCode = status;
      this.headers = headers ?? {};
      return this;
    },
    end(chunk?: string) {
      if (chunk) this.body += chunk;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

function mockRequest(method: string): IncomingMessage {
  return { method, headers: {} } as unknown as IncomingMessage;
}

test('handler ignores non-/api paths', async () => {
  const { service } = makeService();
  const handle = createBoardApiHandler({ service, controlAuthRequired: false });
  const res = mockResponse();
  const handled = await handle(mockRequest('GET'), res, new URL('http://x/'));
  assert.equal(handled, false);
});

test('handler serves /api/health', async () => {
  const { service } = makeService();
  const handle = createBoardApiHandler({ service, controlAuthRequired: true });
  const res = mockResponse();
  const handled = await handle(mockRequest('GET'), res, new URL('http://x/api/health'));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"controlAuthRequired":true/);
});

test('handler rejects unauthorized writes', async () => {
  const { service } = makeService();
  const handle = createBoardApiHandler({ service, controlAuthRequired: true, authorize: () => false });
  const res = mockResponse();
  const handled = await handle(mockRequest('POST'), res, new URL('http://x/api/tasks'));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
});

async function invokePost(
  handle: ReturnType<typeof createBoardApiHandler>,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  } as unknown as IncomingMessage;
  const res = mockResponse();
  const handled = await handle(req, res, new URL(`http://x${pathname}`));
  assert.equal(handled, true);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

test('followUpTask reopens the session and records a comment', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: 'agent-coder' }, 'user-dev');
  await service.updateTask(created.id, { status: 'review' }, 'user-dev');

  const sessions = new InMemorySessionsRepo();
  await sessions.create({
    id: 's1', actor: 'worker', parentSessionId: null, status: 'succeeded',
    channelOrigin: boardConversationKey(PROJECT, created.id),
    agentSpecId: 'pi-reviewer-default', metadata: {},
  });

  const calls: Array<{ channelOrigin: string; text: string; resumeWorkspace?: boolean }> = [];
  const followService = new BoardApiService({
    board,
    sessions,
    sessionEvents: new InMemorySessionEventsRepo(),
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
    followUp: async (channelOrigin, text, opts) => {
      calls.push({ channelOrigin, text, resumeWorkspace: opts?.resumeWorkspace });
      return { sessionId: 's1', reopened: true, appendedEventIndex: 5 };
    },
  });

  const updated = await followService.followUpTask(
    created.id,
    { bodyMarkdown: 'please also add a test', resumeWorkspace: true },
    'user-dev',
  );
  assert.ok(updated);
  assert.equal(updated!.status, 'working');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.text, 'please also add a test');
  assert.equal(calls[0]!.resumeWorkspace, true);
  assert.equal(calls[0]!.channelOrigin, boardConversationKey(PROJECT, created.id));
  assert.ok(updated!.comments.some((c) => c.bodyMarkdown === 'please also add a test'));
});

test('followUpTask returns null for unknown task', async () => {
  const { board } = makeService();
  const followService = new BoardApiService({
    board,
    sessions: new InMemorySessionsRepo(),
    sessionEvents: new InMemorySessionEventsRepo(),
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
    followUp: async () => ({ sessionId: 's1', reopened: false, appendedEventIndex: 1 }),
  });
  const result = await followService.followUpTask('nope', { bodyMarkdown: 'x' }, 'user-dev');
  assert.equal(result, null);
});

test('followUpTask rejects when the linked session is still running', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: 'agent-coder' }, 'user-dev');
  await service.updateTask(created.id, { status: 'review' }, 'user-dev');

  const sessions = new InMemorySessionsRepo();
  const origin = boardConversationKey(PROJECT, created.id);
  await sessions.create({
    id: 's-running', actor: 'worker', parentSessionId: null, status: 'running',
    channelOrigin: origin, agentSpecId: 'pi-reviewer-default', metadata: {},
  });

  const followService = new BoardApiService({
    board,
    sessions,
    sessionEvents: new InMemorySessionEventsRepo(),
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
    followUp: async () => ({ sessionId: 's-running', reopened: false, appendedEventIndex: 1 }),
  });

  await assert.rejects(
    () => followService.followUpTask(created.id, { bodyMarkdown: 'too soon' }, 'user-dev'),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  );

  const task = await board.getTask(created.id);
  assert.equal(task!.status, 'review');
});

test('handler POST /api/tasks/:id/follow-up validates body', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: null }, 'user-dev');
  const sessions = new InMemorySessionsRepo();
  await sessions.create({
    id: 's-h', actor: 'worker', parentSessionId: null, status: 'succeeded',
    channelOrigin: boardConversationKey(PROJECT, created.id),
    agentSpecId: 'pi-reviewer-default', metadata: {},
  });
  const handle = createBoardApiHandler({
    service: new BoardApiService({
      board,
      sessions,
      sessionEvents: new InMemorySessionEventsRepo(),
      tenantId: TENANT,
      projectId: PROJECT,
      projects: makeProjects(),
      defaultRepoSlug: 'sample/service',
      followUp: async () => ({ sessionId: 's-h', reopened: true, appendedEventIndex: 1 }),
    }),
    controlAuthRequired: false,
  });
  const empty = await invokePost(handle, `/api/tasks/${created.id}/follow-up`, { bodyMarkdown: '   ' });
  assert.equal(empty.status, 400);
});

test('followUpTask rejects when no prior session exists', async () => {
  const { board, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: 'agent-coder' }, 'user-dev');
  await service.updateTask(created.id, { status: 'review' }, 'user-dev');

  const followService = new BoardApiService({
    board,
    sessions: new InMemorySessionsRepo(),
    sessionEvents: new InMemorySessionEventsRepo(),
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
    followUp: async () => ({ sessionId: 's', reopened: true, appendedEventIndex: 0 }),
  });

  await assert.rejects(
    () => followService.followUpTask(created.id, { bodyMarkdown: 'please retry' }, 'user-dev'),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  );
});

test('createAgent validates profile template and persists registry row', async () => {
  const { board, service } = makeService();
  const agentService = new BoardApiService({
    board,
    sessions: new InMemorySessionsRepo(),
    sessionEvents: new InMemorySessionEventsRepo(),
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
    listProfileTemplates: async () => [{
      id: 'pi-reviewer-default',
      actor: 'worker',
      engine: 'pi-agent',
      runtime: 'sandbox-docker',
      model: 'gpt-5.4-mini',
      description: 'Reviewer',
    }],
  });

  const created = await agentService.createAgent({
    displayName: 'My Reviewer',
    profileId: 'pi-reviewer-default',
  });
  assert.equal(created.kind, 'agent');
  assert.equal(created.displayName, 'My Reviewer');
  assert.equal(created.title, 'pi-reviewer-default');

  await assert.rejects(
    () => agentService.createAgent({ displayName: 'Bad', profileId: 'missing-profile' }),
    /Unknown profile template/,
  );
});

test('taskRuns splits attempts from worker_start/worker_end events', async () => {
  const { board, sessions, sessionEvents, service } = makeService();
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'T', assigneeId: 'agent-coder' }, 'user-dev');
  const origin = boardConversationKey(PROJECT, created.id);
  await sessions.create({
    id: 'sess-runs',
    actor: 'worker',
    parentSessionId: null,
    status: 'succeeded',
    channelOrigin: origin,
    agentSpecId: 'pi-reviewer-default',
    metadata: { attemptNumber: 2 },
  });
  await sessionEvents.append({
    sessionId: 'sess-runs',
    eventType: 'input',
    kind: 'channel.input',
    payload: { text: 'first' },
  });
  await sessionEvents.append({
    sessionId: 'sess-runs',
    eventType: 'turn',
    kind: 'worker_start',
    payload: { startedAt: '2026-06-28T00:00:00.000Z' },
  });
  await sessionEvents.append({
    sessionId: 'sess-runs',
    eventType: 'turn',
    kind: 'worker_end',
    payload: {
      status: 'succeeded',
      summary: 'done',
      durationMs: 100,
      snapshotRef: { type: 'local', id: 'snap-1', location: '/snaps/snap-1' },
    },
  });

  const runs = await service.taskRuns(created.id);
  assert.ok(runs);
  assert.equal(runs!.sessionId, 'sess-runs');
  assert.equal(runs!.attempts.length, 1);
  assert.equal(runs!.attempts[0]!.snapshotRefEncoded, 'local:snap-1');
});

test('taskUsage rolls up token_usage from agent_runs', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const sessionEvents = new InMemorySessionEventsRepo();
  const agentRuns = new InMemoryAgentRunsRepo();
  const service = new BoardApiService({
    board,
    sessions,
    sessionEvents,
    agentRuns,
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
  });
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'Cost', assigneeId: null }, 'user-dev');
  await agentRuns.start({
    id: 'run-1',
    sessionId: 'sess-cost',
    taskId: created.id,
    attemptNumber: 1,
    agentSpecId: 'coder',
  });
  await agentRuns.finalize({
    id: 'run-1',
    status: 'succeeded',
    endedAt: '2026-08-29T00:00:01.000Z',
    durationMs: 1000,
    tokenUsage: { input: 40, output: 10, cost: { total: 0.002 } },
  });
  const usage = await service.taskUsage(created.id);
  assert.ok(usage);
  assert.equal(usage!.inputTokens, 40);
  assert.equal(usage!.outputTokens, 10);
  assert.equal(usage!.costUsd, 0.002);
});

test('taskArtifacts aggregates latest attempt per path', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const sessionEvents = new InMemorySessionEventsRepo();
  const agentRuns = new InMemoryAgentRunsRepo();
  const service = new BoardApiService({
    board,
    sessions,
    sessionEvents,
    agentRuns,
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
  });
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'Paper', assigneeId: null }, 'user-dev');
  await agentRuns.start({
    id: 'run-1',
    sessionId: 'sess-art',
    taskId: created.id,
    attemptNumber: 1,
    agentSpecId: 'author',
  });
  await agentRuns.finalize({
    id: 'run-1',
    status: 'succeeded',
    endedAt: '2026-08-29T00:00:01.000Z',
    durationMs: 1000,
    snapshotRef: { type: 'local', id: 'snap-1', location: '/snaps/snap-1' },
    artifacts: [{ path: 'artifacts/paper.md', title: 'Draft', primary: true, declared: false }],
  });
  await agentRuns.start({
    id: 'run-2',
    sessionId: 'sess-art',
    taskId: created.id,
    attemptNumber: 2,
    agentSpecId: 'author',
  });
  await agentRuns.finalize({
    id: 'run-2',
    status: 'succeeded',
    endedAt: '2026-08-29T00:00:02.000Z',
    durationMs: 2000,
    snapshotRef: { type: 'local', id: 'snap-2', location: '/snaps/snap-2' },
    artifacts: [
      { path: 'artifacts/paper.md', title: 'Paper', primary: true, declared: true },
      { path: 'artifacts/chart.svg', title: 'Chart', primary: false, declared: true },
    ],
  });

  const view = await service.taskArtifacts(created.id);
  assert.equal(view!.artifacts.length, 2);
  const paper = view!.artifacts.find((a) => a.path === 'artifacts/paper.md');
  assert.equal(paper?.declared, true);
  assert.equal(paper?.attemptNumber, 2);
  assert.ok(paper?.previewUrl.includes('path=artifacts%2Fpaper.md') || paper?.previewUrl.includes('artifacts/paper.md'));
});

test('taskArtifacts returns empty list when the task has no runs', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const sessionEvents = new InMemorySessionEventsRepo();
  const agentRuns = new InMemoryAgentRunsRepo();
  const service = new BoardApiService({
    board,
    sessions,
    sessionEvents,
    agentRuns,
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
  });
  await seedPrincipals(board);
  const created = await service.createTask({ title: 'Empty', assigneeId: null }, 'user-dev');
  const view = await service.taskArtifacts(created.id);
  assert.ok(view);
  assert.equal(view!.taskId, created.id);
  assert.deepEqual(view!.artifacts, []);
});

test('taskArtifacts returns null when the task does not exist', async () => {
  const board = new InMemoryBoardStore();
  const sessions = new InMemorySessionsRepo();
  const sessionEvents = new InMemorySessionEventsRepo();
  const service = new BoardApiService({
    board,
    sessions,
    sessionEvents,
    tenantId: TENANT,
    projectId: PROJECT,
    projects: makeProjects(),
    defaultRepoSlug: 'sample/service',
  });
  const view = await service.taskArtifacts('missing-task');
  assert.equal(view, null);
});
