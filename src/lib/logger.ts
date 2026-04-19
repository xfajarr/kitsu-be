// Logging utility for Kitsu backend
// Provides structured logging with levels and timestamps

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLogLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, context: string, message: string, data?: any): string {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${context}]`;
  
  if (data !== undefined) {
    return `${prefix} ${message} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  debug(context: string, message: string, data?: any) {
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.debug) {
      console.debug(formatMessage('debug', context, message, data));
    }
  },
  
  info(context: string, message: string, data?: any) {
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.info) {
      console.log(formatMessage('info', context, message, data));
    }
  },
  
  warn(context: string, message: string, data?: any) {
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', context, message, data));
    }
  },
  
  error(context: string, message: string, error?: any) {
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.error) {
      const errorData = error instanceof Error 
        ? { message: error.message, stack: error.stack }
        : error;
      console.error(formatMessage('error', context, message, errorData));
    }
  },
  
  // Request logging helper
  request(method: string, path: string, statusCode: number, durationMs: number) {
    this.info('HTTP', `${method} ${path}`, { statusCode, durationMs: `${durationMs}ms` });
  },
};

// Context-specific loggers
export const log = {
  api: (message: string, data?: any) => logger.info('API', message, data),
  auth: (message: string, data?: any) => logger.info('AUTH', message, data),
  db: (message: string, data?: any) => logger.info('DB', message, data),
  blockchain: (message: string, data?: any) => logger.info('BLOCKCHAIN', message, data),
  ai: (message: string, data?: any) => logger.info('AI', message, data),
  error: (context: string, message: string, error?: any) => logger.error(context, message, error),
};

export default logger;
