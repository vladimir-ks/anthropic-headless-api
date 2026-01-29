/**
 * Logger Utility
 *
 * Structured logging with support for different levels.
 * Production-ready with optional Sentry integration.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  module?: string;
  subscriptionId?: string;
  clientId?: string;
  sessionId?: string;
  [key: string]: any;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableSentry?: boolean;
}

class Logger {
  private config: LoggerConfig;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: config?.level || 'info',
      enableConsole: config?.enableConsole !== false,
      enableSentry: config?.enableSentry || false,
    };
  }

  /**
   * Check if log level is enabled
   */
  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.config.level];
  }

  /**
   * Format log message with context
   */
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const moduleName = context?.module ? `[${context.module}]` : '';

    return `${prefix}${moduleName} ${message}`;
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return;

    if (this.config.enableConsole) {
      console.log(this.formatMessage('debug', message, context), context || '');
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;

    if (this.config.enableConsole) {
      console.log(this.formatMessage('info', message, context), context || '');
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return;

    if (this.config.enableConsole) {
      console.warn(this.formatMessage('warn', message, context), context || '');
    }

    // Future: Send to Sentry
    if (this.config.enableSentry) {
      this.sendToSentry('warning', message, context);
    }
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: LogContext): void {
    if (!this.shouldLog('error')) return;

    if (this.config.enableConsole) {
      console.error(this.formatMessage('error', message, context), error || '', context || '');
    }

    // Future: Send to Sentry
    if (this.config.enableSentry) {
      this.sendToSentry('error', message, { ...context, error });
    }
  }

  /**
   * Send to Sentry (placeholder for future implementation)
   */
  private sendToSentry(level: string, message: string, context?: any): void {
    // TODO: Integrate with Sentry SDK when available
    // Sentry.captureMessage(message, {
    //   level: level as SeverityLevel,
    //   extra: context,
    // });
  }

  /**
   * Create child logger with default context
   */
  child(defaultContext: LogContext): Logger {
    const childLogger = new Logger(this.config);

    // Override methods to include default context
    const originalDebug = childLogger.debug.bind(childLogger);
    const originalInfo = childLogger.info.bind(childLogger);
    const originalWarn = childLogger.warn.bind(childLogger);
    const originalError = childLogger.error.bind(childLogger);

    childLogger.debug = (message: string, context?: LogContext) => {
      originalDebug(message, { ...defaultContext, ...context });
    };

    childLogger.info = (message: string, context?: LogContext) => {
      originalInfo(message, { ...defaultContext, ...context });
    };

    childLogger.warn = (message: string, context?: LogContext) => {
      originalWarn(message, { ...defaultContext, ...context });
    };

    childLogger.error = (message: string, error?: Error, context?: LogContext) => {
      originalError(message, error, { ...defaultContext, ...context });
    };

    return childLogger;
  }
}

// Global logger instance
export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  enableConsole: true,
  enableSentry: process.env.SENTRY_DSN ? true : false,
});

// Module-specific loggers
export const createModuleLogger = (moduleName: string): Logger => {
  return logger.child({ module: moduleName });
};
