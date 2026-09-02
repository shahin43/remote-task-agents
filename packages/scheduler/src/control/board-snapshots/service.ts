import type { SnapshotFileEntry, SnapshotIndex, SnapshotStore } from '@remote-sandbox-agents/sandbox';
import { SnapshotError } from '@remote-sandbox-agents/sandbox';
import { basenameOf, contentTypeForPath } from './mime.js';
import { boardFileGroup, isArtifactsFile, isBoardSnapshotPath, type BoardFileGroup } from './paths.js';
import type { SnapshotStoreRouter } from './store-router.js';
import { zipStored } from './zip.js';

const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export interface BoardSnapshotFile extends SnapshotFileEntry {
  group: BoardFileGroup;
}

export class BoardSnapshotService {
  constructor(private readonly router: SnapshotStoreRouter) {}

  private storeForEncoded(encoded: string): { store: SnapshotStore; ref: ReturnType<SnapshotStoreRouter['decode']> } {
    const ref = this.router.decode(encoded);
    return { store: this.router.forRef(ref), ref };
  }

  async listBoardFiles(encoded: string): Promise<{
    ref: string;
    index: SnapshotIndex;
    files: BoardSnapshotFile[];
  }> {
    const { store, ref } = this.storeForEncoded(encoded);
    const [index, files] = await Promise.all([store.readIndex(ref), store.listFiles(ref)]);
    const boardFiles: BoardSnapshotFile[] = [];
    for (const file of files) {
      const group = boardFileGroup(file.path);
      if (!group) continue;
      if (group === 'artifacts' && (file.path === 'artifacts' || file.path.endsWith('/'))) continue;
      if (group === 'repo' && (file.path === 'repo' || file.path.endsWith('/'))) continue;
      boardFiles.push({ ...file, group });
    }
    boardFiles.sort((a, b) => a.path.localeCompare(b.path));
    return { ref: encoded, index, files: boardFiles };
  }

  async readBoardFile(
    encoded: string,
    filePath: string,
    opts?: { download?: boolean },
  ): Promise<{ path: string; body: Buffer; contentType: string; filename: string; truncated: boolean }> {
    if (!isBoardSnapshotPath(filePath)) {
      throw new SnapshotError('snapshot file not found', { path: filePath });
    }
    const { store, ref } = this.storeForEncoded(encoded);
    try {
      const file = await store.readFile(ref, filePath, opts?.download ? undefined : PREVIEW_MAX_BYTES);
      return {
        path: file.path,
        body: file.body,
        contentType: contentTypeForPath(file.path),
        filename: basenameOf(file.path),
        truncated: file.truncated,
      };
    } catch (err) {
      if (err instanceof SnapshotError) throw err;
      throw err;
    }
  }

  async zipArtifacts(encoded: string): Promise<{ body: Buffer; filename: string } | null> {
    const listed = await this.listBoardFiles(encoded);
    const artifactPaths = listed.files.filter((f) => isArtifactsFile(f.path)).map((f) => f.path);
    if (artifactPaths.length === 0) return null;
    const { store, ref } = this.storeForEncoded(encoded);
    const entries: Array<{ name: string; data: Buffer }> = [];
    for (const p of artifactPaths) {
      const file = await store.readFile(ref, p);
      entries.push({ name: p.replace(/^artifacts\//, ''), data: file.body });
    }
    return { body: zipStored(entries), filename: 'artifacts.zip' };
  }

  async readWorkspaceArchive(
    encoded: string,
  ): Promise<{ body: Buffer; filename: string; contentType: string } | null> {
    const { store, ref } = this.storeForEncoded(encoded);
    const index = await store.readIndex(ref);
    if (!index.artifacts['workspace.tar']) return null;
    const file = await store.readFile(ref, 'workspace.tar');
    return {
      body: file.body,
      filename: `workspace-${ref.id}.tar`,
      contentType: 'application/x-tar',
    };
  }
}
