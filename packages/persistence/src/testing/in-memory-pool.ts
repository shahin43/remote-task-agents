import type { DatabasePool } from '../connection.js';

export class InMemoryPool implements DatabasePool {
  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    _text: string,
    _values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }> {
    return { rows: [] as R[], rowCount: 0 };
  }

  async close(): Promise<void> {}
}
