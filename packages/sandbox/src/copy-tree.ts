import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Byte-copy a file onto a new inode without `fs.copyFile` / `fs.cp`.
 *
 * libuv `copyFile` preserves mode (chmod dest to match src). Git objects are
 * 0444; on Docker bind-mounts (`./runs`) that chmod is EACCES because the
 * inode owner is the host uid, not `USER app`.
 */
export async function copyFileOwned(src: string, dest: string, executable = false): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.unlink(dest).catch(() => undefined);
  const mode = executable ? 0o755 : 0o644;
  await pipeline(createReadStream(src), createWriteStream(dest, { mode }));
}

/**
 * Copy a tree as the current process user without preserving source mode.
 */
export async function copyTreeOwned(src: string, dest: string): Promise<void> {
  const stat = await fs.lstat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    for (const name of await fs.readdir(src)) {
      await copyTreeOwned(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  if (stat.isSymbolicLink()) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.symlink(await fs.readlink(src), dest);
    return;
  }
  await copyFileOwned(src, dest, (stat.mode & 0o111) !== 0);
}
