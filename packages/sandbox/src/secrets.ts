import type { CredentialRef } from './types.js';

/** Resolves credential refs to real secret values at materialization time. */
export interface CredentialResolver {
  resolve(ref: CredentialRef): Promise<Record<string, string>>;
}

/** Default resolver: reads `<REF_ID>_*` env vars. Never logs values. */
export class EnvCredentialResolver implements CredentialResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async resolve(ref: CredentialRef): Promise<Record<string, string>> {
    const prefix = `${ref.id}_`;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.env)) {
      if (k.startsWith(prefix) && typeof v === 'string') out[k.slice(prefix.length)] = v;
    }
    return out;
  }
}
