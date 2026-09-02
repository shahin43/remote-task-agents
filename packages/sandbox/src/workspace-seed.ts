import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Junk macOS / Finder members that break GNU↔BSD tar round-trips. */
const TAR_EXCLUDES = ['._*', '.DS_Store', '__MACOSX', 'artifacts/workspace.tar'];

/**
 * Pack a host workspace so the tar root is `/workspace` (`.`, not a wrapper dir).
 * Uses a ustar archive, disables AppleDouble, and never nests the dest tar.
 */
export async function packWorkspaceSeed(workspaceRoot: string, destTar: string): Promise<void> {
  await fs.mkdir(path.dirname(destTar), { recursive: true });
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedDest = path.resolve(destTar);
  const insideTree = isInside(resolvedRoot, resolvedDest);
  const packDest = insideTree ? path.join(os.tmpdir(), `workspace-seed-${process.pid}-${Date.now()}.tar`) : resolvedDest;
  try {
    await runTar(['-cf', packDest, '-C', resolvedRoot, ...excludeArgs(), '.'], { copyfileDisable: true, pinFormat: true });
    if (packDest !== resolvedDest) await fs.rename(packDest, resolvedDest);
  } catch (err) {
    if (packDest !== resolvedDest) await fs.rm(packDest, { force: true }).catch(() => {});
    throw err;
  }
}

export async function extractWorkspaceSeed(tarPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  try {
    await extractSkippingMacJunk(tarPath, destDir);
    return;
  } catch {
    // python3 missing or tarfile rejected the archive — BSD tar is last resort.
  }
  await runTar(['-xf', tarPath, '-C', destDir, ...excludeArgs()], { copyfileDisable: true, pinFormat: false });
}

/**
 * Extract without macOS bsdtar applying AppleDouble (`._repo`) as a resource
 * fork. Guest GNU tars sometimes ship many `._*` members; bsdtar then
 * exits "Truncated input file (needed 512 bytes, only 0 available)" and the
 * worker marks a finished remote guest run as crashed.
 */
function extractSkippingMacJunk(tarPath: string, destDir: string): Promise<void> {
  const script = [
    'import os, sys, tarfile, errno',
    'tar_path, dest = sys.argv[1], sys.argv[2]',
    'os.makedirs(dest, exist_ok=True)',
    'def skip(name):',
    '    norm = name.replace("\\\\", "/")',
    '    parts = norm.split("/")',
    '    if any(p.startswith("._") or p in {".DS_Store", "__MACOSX"} for p in parts):',
    '        return True',
    '    if "/.git/hooks" in "/" + norm or norm.endswith("/.git/hooks"):',
    '        return True',
    '    return norm.endswith("artifacts/workspace.tar")',
    'with tarfile.open(tar_path) as t:',
    '    for m in t.getmembers():',
    '        if skip(m.name):',
    '            continue',
    '        try:',
    '            t.extract(m, dest)',
    '        except OSError as e:',
    '            if e.errno in (errno.EPERM, errno.EACCES):',
    '                continue',
    '            raise',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', script, tarPath, destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `python3 extract exit ${code}`))));
  });
}

function excludeArgs(): string[] {
  return TAR_EXCLUDES.flatMap((pattern) => ['--exclude', pattern]);
}

function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function formatArgs(): string[] {
  // GNU tar wants --format=ustar; BSD/libarchive tar wants --format ustar.
  return process.platform === 'darwin' ? ['--format', 'ustar'] : ['--format=ustar'];
}

function tarBin(): string {
  return process.env.REMOTE_AGENT_TAR_BIN || (process.platform === 'darwin' ? 'tar' : 'tar');
}

async function runTar(argv: string[], opts: { copyfileDisable: boolean; pinFormat: boolean }): Promise<void> {
  const env = { ...process.env };
  if (opts.copyfileDisable) env.COPYFILE_DISABLE = '1';
  const args = opts.pinFormat ? [...formatArgs(), ...argv] : argv;
  await run([tarBin(), ...args], env);
}

function run(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env });
    let err = '';
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${argv.join(' ')} failed: ${err}`));
    });
  });
}
