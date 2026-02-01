export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: Date;
}

const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

function createEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
  return {
    id: crypto.randomUUID(),
    level,
    message,
    context,
    timestamp: new Date(),
  };
}

function addToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

function formatEntry(entry: LogEntry): string {
  const time = entry.timestamp.toISOString();
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  return `[${time}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;
}

const isDev = import.meta.env.DEV;

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    const entry = createEntry('debug', message, context);
    addToBuffer(entry);
    if (isDev) {
      console.debug(formatEntry(entry));
    }
  },

  info(message: string, context?: Record<string, unknown>): void {
    const entry = createEntry('info', message, context);
    addToBuffer(entry);
    if (isDev) {
      console.info(formatEntry(entry));
    }
  },

  warn(message: string, context?: Record<string, unknown>): void {
    const entry = createEntry('warn', message, context);
    addToBuffer(entry);
    console.warn(formatEntry(entry));
  },

  error(message: string, context?: Record<string, unknown>): void {
    const entry = createEntry('error', message, context);
    addToBuffer(entry);
    console.error(formatEntry(entry));
  },

  getBuffer(): LogEntry[] {
    return [...logBuffer];
  },

  clearBuffer(): void {
    logBuffer.length = 0;
  },
};
