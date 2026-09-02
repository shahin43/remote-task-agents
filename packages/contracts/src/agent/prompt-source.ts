import type { PromptContract } from '../orchestrator/prompt.js';
import type { SessionSnapshot } from './session.js';

export interface PromptSource {
  assemble(session: SessionSnapshot): Promise<PromptContract>;
}
