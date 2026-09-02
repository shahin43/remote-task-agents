/**
 * Shipped PromotionTarget: approve an MR intent by attaching git artifacts
 * (changes.patch + branch.bundle) from the attempt snapshot. No remote forge.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BoardStore } from '@remote-sandbox-agents/persistence';
import type { SnapshotRef, SnapshotStore } from '@remote-sandbox-agents/sandbox';
import type { SnapshotStoreRouter } from '../control/board-snapshots/store-router.js';
import type { ProjectConfigRegistry, ProjectRepo } from './project-config.js';
import { parseTaskRepoSelection } from './task-repo-selection.js';
import {
  readTaskMrRequest,
  sanitizeMrSummary,
  type TaskMrRequestRecord,
} from './mr-request.js';

const exec = promisify(execFile);

export interface PromotionTarget {
  approve(opts: PromoteMrRequestOptions): Promise<PromoteMrRequestResult>;
  reject(opts: {
    taskId: string;
    board: Pick<BoardStore, 'getTask' | 'mergeTaskMetadata' | 'comment'>;
    by: string;
    reason?: string;
    clock?: () => string;
  }): Promise<boolean>;
}

export function formatMrPromotionError(reason?: string): string {
  switch (reason) {
    case 'no-mr-request':
    case 'mr-request-missing':
      return 'This task has no pending MR request.';
    case 'request-rejected':
    case 'mr-request-not-pending':
      return 'The MR request is not awaiting approval.';
    case 'missing-snapshot':
    case 'snapshot-missing':
      return 'The workspace snapshot for this MR request could not be found.';
    case 'already-opened':
      return 'Promotion artifacts were already produced for this task.';
    case 'empty-diff':
      return 'The snapshot has no committed diff to promote.';
    case 'missing-source-branch-metadata':
      return 'The snapshot is missing git branch metadata.';
    default:
      return reason ?? 'MR promotion failed.';
  }
}

export interface PromoteMrRequestOptions {
  taskId: string;
  board: Pick<BoardStore, 'getTask' | 'mergeTaskMetadata' | 'comment'>;
  projects: ProjectConfigRegistry;
  projectId: string;
  tenantId: string;
  defaultRepoSlug: string;
  snapshotStore: SnapshotStore;
  snapshotStores?: SnapshotStoreRouter;
  by: string;
  overrides?: { draft?: boolean; targetBranch?: string };
  promotionRoot?: string;
  clock?: () => string;
}

export interface PromoteMrRequestResult {
  ok: boolean;
  status: TaskMrRequestRecord['status'];
  mrUrl?: string;
  patchPath?: string;
  bundlePath?: string;
  reason?: string;
}

interface BranchSidecar {
  workingBranch?: string;
  baseSha?: string;
  commits?: string[];
}

async function gitExec(args: string[], opts: { cwd?: string } = {}) {
  return exec('git', args, {
    cwd: opts.cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function readBranchSidecar(store: SnapshotStore, ref: SnapshotRef): Promise<BranchSidecar | null> {
  try {
    const content = await store.readFile(ref, 'git/branch.json');
    return JSON.parse(content.content) as BranchSidecar;
  } catch {
    return null;
  }
}

async function readChangesPatch(store: SnapshotStore, ref: SnapshotRef): Promise<string> {
  try {
    const content = await store.readFile(ref, 'git/changes.patch');
    return content.content.trim();
  } catch {
    return '';
  }
}

function resolvePrimaryRepo(
  taskMetadata: Record<string, unknown>,
  projectRepos: ProjectRepo[],
): ProjectRepo | null {
  const selection = parseTaskRepoSelection(taskMetadata);
  const slug = selection?.primaryRepo ?? selection?.repos[0] ?? projectRepos[0]?.slug;
  if (!slug) return null;
  return projectRepos.find((r) => r.slug === slug) ?? null;
}

export async function alignWorkingBranch(repoDir: string, workingBranch: string): Promise<void> {
  const { stdout: current } = await gitExec(['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  if (current.trim() === workingBranch) return;
  await gitExec(['-C', repoDir, 'branch', '-f', workingBranch, 'HEAD']);
  await gitExec(['-C', repoDir, 'checkout', workingBranch]);
}

export async function promoteMrRequest(opts: PromoteMrRequestOptions): Promise<PromoteMrRequestResult> {
  const task = await opts.board.getTask(opts.taskId);
  if (!task) return { ok: false, status: 'failed', reason: 'task-not-found' };

  const existing = readTaskMrRequest(task.metadata);
  if (!existing) return { ok: false, status: 'failed', reason: 'no-mr-request' };
  if (existing.status === 'opened' && (existing.patchArtifact || existing.mrUrl)) {
    return {
      ok: true,
      status: 'opened',
      mrUrl: existing.mrUrl,
      patchPath: existing.patchArtifact,
      bundlePath: existing.bundleArtifact,
      reason: 'already-opened',
    };
  }
  if (existing.status === 'rejected') {
    return { ok: false, status: 'rejected', reason: 'request-rejected' };
  }
  if (!existing.snapshotRef) {
    return { ok: false, status: 'blocked', reason: 'missing-snapshot' };
  }

  const project = opts.projects.resolve(opts.projectId, opts.tenantId, opts.defaultRepoSlug);
  const repo = resolvePrimaryRepo(task.metadata, project.repos);
  const dest = repo?.dest ?? 'repo';
  const targetBranch = opts.overrides?.targetBranch ?? existing.targetBranch ?? repo?.baseBranch ?? 'main';
  const draft = opts.overrides?.draft ?? existing.draft ?? true;
  const snapshotRef = existing.snapshotRef as SnapshotRef;
  const store = opts.snapshotStores?.forRef(snapshotRef) ?? opts.snapshotStore;

  const promotionRoot = opts.promotionRoot ?? path.join(os.tmpdir(), 'remote-agent-promote');
  const workDir = path.join(promotionRoot, opts.taskId, Date.now().toString());
  const artifactDir = path.join(promotionRoot, opts.taskId, 'artifacts');
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });

  try {
    await store.restore(snapshotRef, workDir);
    const repoDir = path.join(workDir, dest);
    const branchMeta = await readBranchSidecar(store, snapshotRef);
    const sourceBranch = branchMeta?.workingBranch;
    if (sourceBranch) {
      await alignWorkingBranch(repoDir, sourceBranch).catch(() => undefined);
    }

    let patch = await readChangesPatch(store, snapshotRef);
    if (!patch) {
      try {
        const { stdout } = await gitExec(['-C', repoDir, 'diff', `${targetBranch}...HEAD`]);
        patch = stdout.trim();
      } catch {
        patch = '';
      }
    }
    if (!patch) {
      try {
        const { stdout } = await gitExec(['-C', repoDir, 'diff']);
        patch = stdout.trim();
      } catch {
        patch = '';
      }
    }
    if (!patch) {
      return { ok: false, status: 'failed', reason: 'empty-diff' };
    }

    const patchPath = path.join(artifactDir, 'changes.patch');
    const bundlePath = path.join(artifactDir, 'branch.bundle');
    await fs.writeFile(patchPath, `${patch}\n`, 'utf8');
    await gitExec(['-C', repoDir, 'bundle', 'create', bundlePath, 'HEAD']);

    const openedAt = (opts.clock ?? (() => new Date().toISOString()))();
    const updated: TaskMrRequestRecord = {
      ...existing,
      status: 'opened',
      targetBranch,
      draft,
      sourceBranch,
      openedAt,
      patchArtifact: patchPath,
      bundleArtifact: bundlePath,
      error: undefined,
    };
    await opts.board.mergeTaskMetadata({
      taskId: opts.taskId,
      patch: { mrRequest: updated as unknown as Record<string, unknown> },
    });
    const howTo = [
      `Promotion artifacts ready for "${existing.title}".`,
      '',
      sanitizeMrSummary(existing.summary),
      '',
      'Apply locally:',
      `  git am < ${patchPath}`,
      'or',
      `  git fetch ${bundlePath} HEAD && git checkout FETCH_HEAD`,
    ].join('\n');
    await opts.board.comment({ taskId: opts.taskId, by: opts.by, text: howTo });
    return { ok: true, status: 'opened', patchPath, bundlePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: TaskMrRequestRecord = {
      ...existing,
      status: 'failed',
      error: message.slice(0, 500),
    };
    await opts.board.mergeTaskMetadata({
      taskId: opts.taskId,
      patch: { mrRequest: failed as unknown as Record<string, unknown> },
    });
    return { ok: false, status: 'failed', reason: message };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function rejectMrRequest(opts: {
  taskId: string;
  board: Pick<BoardStore, 'getTask' | 'mergeTaskMetadata' | 'comment'>;
  by: string;
  reason?: string;
  clock?: () => string;
}): Promise<boolean> {
  const task = await opts.board.getTask(opts.taskId);
  if (!task) return false;
  const existing = readTaskMrRequest(task.metadata);
  if (!existing || existing.status === 'opened') return false;

  const updated: TaskMrRequestRecord = {
    ...existing,
    status: 'rejected',
    rejectedAt: (opts.clock ?? (() => new Date().toISOString()))(),
    ...(opts.reason ? { error: opts.reason } : {}),
  };
  await opts.board.mergeTaskMetadata({
    taskId: opts.taskId,
    patch: { mrRequest: updated as unknown as Record<string, unknown> },
  });
  await opts.board.comment({
    taskId: opts.taskId,
    by: opts.by,
    text: opts.reason ? `MR request rejected: ${opts.reason}` : 'MR request rejected.',
  });
  return true;
}

export const GitArtifactPromotion: PromotionTarget = {
  approve: promoteMrRequest,
  reject: rejectMrRequest,
};
