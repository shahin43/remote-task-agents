import type { TaskIntent } from '../common/types.js';

export interface ProfileDecision {
  profileId: string;
  reason: string;
  confidence: number;
}

export interface IntentProfileMapping {
  intent: TaskIntent;
  profileId: string;
}
