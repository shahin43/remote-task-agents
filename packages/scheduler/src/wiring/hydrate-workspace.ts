import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { SandboxSession, SnapshotRef } from '@remote-sandbox-agents/sandbox';
import { copyTreeOwned } from '@remote-sandbox-agents/sandbox';

export type OverlaySession = Pick<SandboxSession, 'state'>;

export interface OverlayHydratedSnapshotOpts {
  stagingDir: string;
  session: OverlaySession;
  snapshotRef?: SnapshotRef;
  dockerCp?: (stagingDir: string, containerId: string, dest: string) => Promise<void>;
  dockerBin?: string;
}

export async function overlayHydratedSnapshot(opts: OverlayHydratedSnapshotOpts): Promise<void> {
  const { stagingDir, session } = opts;
  if (session.state.type === 'docker') {
    const containerId = String(session.state.containerId ?? '');
    const dest = String(session.state.manifestRoot ?? session.state.workspaceRoot ?? '/workspace');
    const dockerCp = opts.dockerCp ?? ((src, id, root) => dockerCpDefault(opts.dockerBin ?? 'docker', src, id, root));
    await dockerCp(stagingDir, containerId, dest);
    return;
  }
  const dest = session.state.workspaceRoot;
  await fs.mkdir(dest, { recursive: true });
  await copyTreeOwned(stagingDir, dest);
}

function dockerCpDefault(dockerBin: string, stagingDir: string, containerId: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBin, ['cp', `${stagingDir}/.`, `${containerId}:${dest}`]);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`docker cp failed: ${stderr}`)),
    );
  });
}
