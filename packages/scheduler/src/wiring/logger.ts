export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface Logger {
  info(sessionId: string, msg: string): void;
  warn(sessionId: string, msg: string): void;
  error(sessionId: string, msg: string): void;
  debug(sessionId: string, msg: string): void;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createLogger(component: string): Logger {
  const write = (level: LogLevel, sessionId: string, msg: string) => {
    const line = `[${level} ${timestamp()} ${component}:session-${shortId(sessionId)}] ${msg}\n`;
    if (level === 'ERROR' || level === 'WARN') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  };

  return {
    info: (sessionId, msg) => write('INFO', sessionId, msg),
    warn: (sessionId, msg) => write('WARN', sessionId, msg),
    error: (sessionId, msg) => write('ERROR', sessionId, msg),
    debug: (sessionId, msg) => write('DEBUG', sessionId, msg),
  };
}
