import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SnapshotError } from '../errors.js';
import type {
  SnapshotFileContent,
  SnapshotFileEntry,
  SnapshotIndex,
  SnapshotInput,
  SnapshotRef,
  SnapshotStore,
} from './snapshot.js';

/** Normalize and validate a relative path inside a snapshot. */
export function normalizeSnapshotPath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.startsWith('/')) {
    throw new SnapshotError('invalid snapshot file path', { path: raw });
  }
  return normalized;
}

/** Encode a snapshot ref for URL paths: `local:<id>`. */
export function encodeSnapshotRef(ref: SnapshotRef): string {
  return `${ref.type}:${ref.id}`;
}

/** Decode `local:<id>` into a ref rooted under storeRoot. */
export function decodeSnapshotRef(encoded: string, storeRoot: string): SnapshotRef {
  const sep = encoded.indexOf(':');
  if (sep <= 0) throw new SnapshotError('invalid snapshot ref encoding', { encoded });
  const type = encoded.slice(0, sep);
  const id = encoded.slice(sep + 1);
  if (!id || id.includes('/') || id.includes('..')) {
    throw new SnapshotError('invalid snapshot ref id', { encoded });
  }
  return { type, id, location: path.join(storeRoot, id) };
}

export interface LocalSnapshotStoreOptions {
  /** Directory under which each snapshot is stored as <root>/<id>/. */
  root: string;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export class LocalSnapshotStore implements SnapshotStore {
  readonly storeType = 'local';
  constructor(private readonly opts: LocalSnapshotStoreOptions) {}

  private dirFor(id: string): string {
    return path.join(this.opts.root, id);
  }

  async persist(input: SnapshotInput): Promise<SnapshotRef> {
    const dir = this.dirFor(input.id);
    await fs.mkdir(dir, { recursive: true });
    const artifacts: SnapshotIndex['artifacts'] = {};

    // 1. workspace.tar (stream to disk, then checksum)
    const tarPath = path.join(dir, 'workspace.tar');
    await new Promise<void>((resolve, reject) => {
      const w = createWriteStream(tarPath);
      input.workspaceTar.pipe(w);
      w.on('finish', () => resolve());
      w.on('error', reject);
    });
    artifacts['workspace.tar'] = await this.recordArtifact(tarPath);

    // 2. sidecars (JSON)
    for (const [name, value] of Object.entries(input.sidecars)) {
      const p = path.join(dir, name);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(value, null, 2));
      artifacts[name] = await this.recordArtifact(p);
    }

    // 3. raw files (text)
    for (const [name, content] of Object.entries(input.files)) {
      const p = path.join(dir, name);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content);
      artifacts[name] = await this.recordArtifact(p);
    }

    const index: SnapshotIndex = {
      schemaVersion: 1,
      id: input.id,
      createdAt: input.createdAt,
      providerType: input.providerType,
      artifacts,
      restorable: true,
    };
    await fs.writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(index, null, 2));
    return { type: 'local', id: input.id, location: dir };
  }

  private async recordArtifact(p: string): Promise<{ checksum: string; bytes: number }> {
    const buf = await fs.readFile(p);
    return { checksum: sha256(buf), bytes: buf.byteLength };
  }

  async readIndex(ref: SnapshotRef): Promise<SnapshotIndex> {
    const raw = await fs.readFile(path.join(ref.location, 'snapshot.json'), 'utf8').catch(() => {
      throw new SnapshotError('snapshot index not found', { ref });
    });
    return JSON.parse(raw) as SnapshotIndex;
  }

  async restorable(ref: SnapshotRef): Promise<boolean> {
    let index: SnapshotIndex;
    try {
      index = await this.readIndex(ref);
    } catch {
      return false;
    }
    for (const [name, meta] of Object.entries(index.artifacts)) {
      const p = path.join(ref.location, name);
      const buf = await fs.readFile(p).catch(() => null);
      if (!buf || sha256(buf) !== meta.checksum) return false;
    }
    return true;
  }

  async restore(ref: SnapshotRef, destRoot: string): Promise<SnapshotIndex> {
    if (!(await this.restorable(ref))) {
      throw new SnapshotError('snapshot not restorable (missing or corrupt artifacts)', { ref });
    }
    const index = await this.readIndex(ref);
    await fs.mkdir(destRoot, { recursive: true });
    const tarPath = path.join(ref.location, 'workspace.tar');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xf', tarPath, '-C', destRoot]);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new SnapshotError('tar extract failed', { code }))));
    });
    return index;
  }

  async listFiles(ref: SnapshotRef): Promise<SnapshotFileEntry[]> {
    const index = await this.readIndex(ref);
    const entries: SnapshotFileEntry[] = [];
    for (const [artifactPath, meta] of Object.entries(index.artifacts)) {
      if (artifactPath === 'workspace.tar') continue;
      entries.push({ path: artifactPath, bytes: meta.bytes, source: 'sidecar' });
    }
    const tarPath = path.join(ref.location, 'workspace.tar');
    const tarExists = await fs.access(tarPath).then(() => true).catch(() => false);
    if (tarExists) {
      const lines = await listTarMembers(tarPath);
      for (const line of lines) {
        const p = line.replace(/^\.\/?/, '').replace(/\/$/, '');
        if (!p) continue;
        entries.push({ path: p, source: 'workspace' });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  /**
   * Enumerate every snapshot directory under `root`. Cheap discovery for
   * retention sweeps: reads each snapshot's `snapshot.json` (createdAt) plus
   * a single `du -sk` for the directory size. Returns `null` createdAt for
   * directories without a valid index — the sweep can decide whether to
   * treat them as orphans.
   */
  async listAll(): Promise<Array<{ id: string; createdAt: string | null; bytes: number }>> {
    const entries = await fs.readdir(this.opts.root, { withFileTypes: true }).catch(() => []);
    const out: Array<{ id: string; createdAt: string | null; bytes: number }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const dir = this.dirFor(id);
      let createdAt: string | null = null;
      try {
        const raw = await fs.readFile(path.join(dir, 'snapshot.json'), 'utf8');
        const idx = JSON.parse(raw) as SnapshotIndex;
        createdAt = idx.createdAt;
      } catch {
        // Treat as orphan; createdAt stays null.
      }
      out.push({ id, createdAt, bytes: await this.dirBytes(dir) });
    }
    return out;
  }

  /**
   * Delete a snapshot directory. Returns the bytes freed (or 0 if the
   * directory was already gone). Idempotent: a delete that races with
   * another sweep does not throw.
   */
  async delete(id: string): Promise<{ freedBytes: number }> {
    const dir = this.dirFor(id);
    const bytes = await this.dirBytes(dir);
    await fs.rm(dir, { recursive: true, force: true });
    return { freedBytes: bytes };
  }

  private async dirBytes(dir: string): Promise<number> {
    let total = 0;
    const stack: string[] = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const p = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(p);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          const stat = await fs.stat(p).catch(() => null);
          if (stat) total += stat.size;
        }
      }
    }
    return total;
  }

  async readFile(ref: SnapshotRef, filePath: string, maxBytes?: number): Promise<SnapshotFileContent> {
    const normalized = normalizeSnapshotPath(filePath);
    const cap = maxBytes ?? Number.POSITIVE_INFINITY;
    const index = await this.readIndex(ref);
    const sidecarMeta = index.artifacts[normalized];
    if (sidecarMeta) {
      const buf = await fs.readFile(path.join(ref.location, normalized));
      return sliceSnapshotBytes(normalized, buf, cap);
    }
    const tarPath = path.join(ref.location, 'workspace.tar');
    const buf = await extractTarMember(tarPath, normalized, cap);
    return sliceSnapshotBytes(normalized, buf, cap);
  }
}

export function sliceSnapshotBytes(pathName: string, buf: Buffer, maxBytes: number): SnapshotFileContent {
  const truncated = buf.byteLength > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  return { path: pathName, content: slice.toString('utf8'), body: Buffer.from(slice), truncated };
}

export async function extractTarMember(tarPath: string, member: string, maxBytes: number): Promise<Buffer> {
  const limit = Number.isFinite(maxBytes) ? maxBytes + 1 : Number.POSITIVE_INFINITY;
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xO', '-f', tarPath, member]);
    const chunks: Buffer[] = [];
    let total = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      if (total >= limit) return;
      const take = Number.isFinite(limit) ? Math.min(chunk.length, limit - total) : chunk.length;
      chunks.push(take === chunk.length ? chunk : chunk.subarray(0, take));
      total += take;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new SnapshotError('tar read failed', { path: member, code }));
    });
  });
}

export async function listTarMembers(tarPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tf', tarPath]);
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(out.split('\n').filter(Boolean))
        : reject(new SnapshotError('tar list failed', { code })),
    );
  });
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
