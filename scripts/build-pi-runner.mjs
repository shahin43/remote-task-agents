// Bundle the in-container pi worker entrypoint into a single self-contained CJS
// file so the sandbox container needs only `node` (no node_modules). pi-ai and
// all deps are inlined. Output is mounted/written into the workspace at runtime.
import { build } from 'esbuild';

const outfile = 'packages/agent-engines/dist/pi-runner.bundle.cjs';

await build({
  entryPoints: ['packages/agent-engines/src/pi/pi-runner-main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile,
  sourcemap: false,
  logLevel: 'info',
  external: ['@opentelemetry/api'],
});

console.log(`built ${outfile}`);
