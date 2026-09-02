import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes a worker session's raw transcript to its workspace as JSONL.
 *
 * Forward-laying infrastructure for the future worker-engine phase: the worker
 * engine will stream each pi-ai message and tool call into this logger so the
 * full raw transcript is retained on disk for debugging and auditing,
 * independent of the trimmed structured summary sent to the orchestrator.
 *
 * Intentionally unwired today — no engine hook feeds it yet.
 *
 *   {logsDir}/session.jsonl    — one JSON message object per line
 *   {logsDir}/tool-calls.jsonl — one tool invocation per line, with timing
 */
export class WorkerSessionLogger {
  private readonly sessionLines: string[] = [];
  private readonly toolLines: string[] = [];

  constructor(private readonly logsDir: string) {}

  logMessage(msg: unknown): void {
    this.sessionLines.push(JSON.stringify(msg));
  }

  logToolCall(call: { name: string; args: unknown; result: unknown; durationMs: number }): void {
    this.toolLines.push(JSON.stringify({ ...call, timestamp: new Date().toISOString() }));
  }

  async flush(): Promise<void> {
    if (this.sessionLines.length === 0 && this.toolLines.length === 0) return;
    await fs.mkdir(this.logsDir, { recursive: true });
    if (this.sessionLines.length > 0) {
      await fs.appendFile(path.join(this.logsDir, 'session.jsonl'), this.sessionLines.join('\n') + '\n');
      this.sessionLines.length = 0;
    }
    if (this.toolLines.length > 0) {
      await fs.appendFile(path.join(this.logsDir, 'tool-calls.jsonl'), this.toolLines.join('\n') + '\n');
      this.toolLines.length = 0;
    }
  }
}
