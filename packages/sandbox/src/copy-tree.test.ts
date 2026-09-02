import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { copyTreeOwned } from './copy-tree.js';

test('copyTreeOwned copies a 0444 git-object-style file as a writable owner copy', async () => {
  const src = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-src-'));
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-dest-'));
  const objDir = path.join(src, '.git', 'objects', '6f');
  await fs.mkdir(objDir, { recursive: true });
  const srcObj = path.join(objDir, 'b17bd23bcb1a68b40aeda6e7bb5420f5f1848d');
  await fs.writeFile(srcObj, 'blob');
  await fs.chmod(srcObj, 0o444);

  await copyTreeOwned(src, dest);

  const destObj = path.join(dest, '.git', 'objects', '6f', 'b17bd23bcb1a68b40aeda6e7bb5420f5f1848d');
  assert.notEqual((await fs.stat(srcObj)).ino, (await fs.stat(destObj)).ino);
  await fs.writeFile(destObj, 'rewritten');
  assert.equal(await fs.readFile(destObj, 'utf8'), 'rewritten');
  await fs.rm(src, { recursive: true, force: true });
  await fs.rm(dest, { recursive: true, force: true });
});
