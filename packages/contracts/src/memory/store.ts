export interface MemoryProposal {
  key: string;
  content: string;
  sourceRunId: string;
  confidence: number;
  proposedAt: string;
}

export interface MemorySnapshot {
  content: string;
  loadedAt: string;
  charCount: number;
}

export interface MemoryStore {
  load(repoRoot: string): Promise<MemorySnapshot>;
  search?(query: string): Promise<string[]>;
}
