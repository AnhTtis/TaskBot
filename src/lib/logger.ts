type LogLevel = 'info' | 'warn' | 'error';

function formatMessage(level: LogLevel, message: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
}

function write(level: LogLevel, message: string, ...details: unknown[]): void {
  const line = formatMessage(level, message);

  switch (level) {
    case 'info':
      console.info(line, ...details);
      return;
    case 'warn':
      console.warn(line, ...details);
      return;
    case 'error':
      console.error(line, ...details);
  }
}

export const logger = {
  info(message: string, ...details: unknown[]): void {
    write('info', message, ...details);
  },
  warn(message: string, ...details: unknown[]): void {
    write('warn', message, ...details);
  },
  error(message: string, ...details: unknown[]): void {
    write('error', message, ...details);
  },
} as const;
