// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level: LogLevel;
  json: boolean;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(defaultMeta: Record<string, unknown>): Logger;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ---------------------------------------------------------------------------
// Logger Implementation
// ---------------------------------------------------------------------------

/**
 * Create a structured logger suitable for production use.
 * Outputs to stdout (info/debug) or stderr (warn/error).
 * Supports JSON format for log aggregation systems.
 */
export function createLogger(options: LoggerOptions): Logger {
  const minLevel = LOG_LEVELS[options.level];

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= minLevel;
  }

  function formatMessage(
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> = {}
  ): string {
    const timestamp = new Date().toISOString();

    if (options.json) {
      const entry: LogEntry = {
        timestamp,
        level,
        message,
        ...meta,
      };
      return JSON.stringify(entry);
    }

    // Human-readable format
    const prefix = `[${timestamp}] ${level.toUpperCase().padEnd(5)}`;
    const metaStr =
      Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `${prefix} ${message}${metaStr}`;
  }

  function log(
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> = {},
    defaultMeta: Record<string, unknown> = {}
  ): void {
    if (!shouldLog(level)) return;

    const combinedMeta = { ...defaultMeta, ...meta };
    const formatted = formatMessage(level, message, combinedMeta);

    // Use stderr for warn/error, stdout for info/debug
    if (level === "warn" || level === "error") {
      console.error(formatted);
    } else {
      console.log(formatted);
    }
  }

  function createLoggerInstance(
    defaultMeta: Record<string, unknown> = {}
  ): Logger {
    return {
      debug: (msg, meta) => log("debug", msg, meta, defaultMeta),
      info: (msg, meta) => log("info", msg, meta, defaultMeta),
      warn: (msg, meta) => log("warn", msg, meta, defaultMeta),
      error: (msg, meta) => log("error", msg, meta, defaultMeta),
      child: (childMeta) =>
        createLoggerInstance({ ...defaultMeta, ...childMeta }),
    };
  }

  return createLoggerInstance();
}

/**
 * Create a no-op logger that discards all messages.
 * Useful for testing or when logging is disabled.
 */
export function createNoopLogger(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}
