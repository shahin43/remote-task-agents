/**
 * Bundle entrypoint for the in-container pi worker. esbuild bundles this file
 * (with @earendil-works/pi-ai included) into a single self-contained CJS file so
 * the sandbox container needs only `node` — no node_modules. It always runs
 * `runMain`; the testable logic lives in `pi-runner-entry.ts`.
 */
import { runMain } from './pi-runner-entry.js';

const root = process.argv[2] ?? '/workspace';
runMain(root)
  .then((result) => {
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.status === 'completed' ? 0 : 1;
  })
  .catch((err: unknown) => {
    process.stdout.write(JSON.stringify({ status: 'failed', summary: '', toolCount: 0, error: err instanceof Error ? err.message : String(err) }) + '\n');
    process.exitCode = 1;
  });
