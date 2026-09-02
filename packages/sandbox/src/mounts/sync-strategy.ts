/** Minimal object-store client the S3 sync strategy depends on. */
export interface ObjectStoreClient {
  /** List object keys under a prefix. */
  list(bucket: string, prefix: string): Promise<string[]>;
  /** Get an object's bytes. */
  get(bucket: string, key: string): Promise<Buffer>;
  /** Put an object's bytes. */
  put(bucket: string, key: string, body: Buffer): Promise<void>;
}

export interface SyncDownArgs {
  client: ObjectStoreClient;
  bucket: string;
  prefix: string;
  /** absolute destination dir on the host. */
  destDir: string;
}

/** Download every object under prefix into destDir, preserving the key suffix as a path. */
export async function syncDown(args: SyncDownArgs): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const keys = await args.client.list(args.bucket, args.prefix);
  const written: string[] = [];
  for (const key of keys) {
    const rel = key.startsWith(args.prefix) ? key.slice(args.prefix.length).replace(/^\//, '') : key;
    const dest = path.join(args.destDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, await args.client.get(args.bucket, key));
    written.push(rel);
  }
  return written;
}
