/**
 * Global CLI context for shared options and state.
 * Provides consistent behavior across all commands.
 */

export interface CLIContext {
  /** Output JSON instead of human-readable text */
  json: boolean;
  /** Suppress spinners and progress indicators */
  quiet: boolean;
  /** Skip confirmation prompts (auto-yes) */
  yes: boolean;
  /** Fail instead of prompting for input (CI mode) */
  noInput: boolean;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Number of retry attempts for failed requests */
  retry: number;
  /** Conflict resolution strategy */
  onConflict: "fail" | "skip" | "suffix";
}

const DEFAULT_CONTEXT: CLIContext = {
  json: false,
  quiet: false,
  yes: false,
  noInput: false,
  timeout: 30000, // 30 seconds
  retry: 2,
  onConflict: "fail",
};

let currentContext: CLIContext = { ...DEFAULT_CONTEXT };

/**
 * Initialize CLI context from command line arguments and environment.
 */
export function initContext(argv: string[] = process.argv): CLIContext {
  currentContext = { ...DEFAULT_CONTEXT };

  // Parse global flags from argv
  if (argv.includes("--json")) {
    currentContext.json = true;
    currentContext.quiet = true; // JSON mode implies quiet
  }

  if (argv.includes("--quiet") || argv.includes("-q")) {
    currentContext.quiet = true;
  }

  if (argv.includes("--yes") || argv.includes("-y")) {
    currentContext.yes = true;
  }

  if (argv.includes("--no-input")) {
    currentContext.noInput = true;
    currentContext.yes = true; // No input implies auto-yes
  }

  // Parse --timeout value
  const timeoutIdx = argv.findIndex((arg) => arg === "--timeout");
  if (timeoutIdx !== -1 && argv[timeoutIdx + 1]) {
    const value = parseInt(argv[timeoutIdx + 1], 10);
    if (!isNaN(value) && value > 0) {
      currentContext.timeout = value;
    }
  }

  // Parse --retry value
  const retryIdx = argv.findIndex((arg) => arg === "--retry");
  if (retryIdx !== -1 && argv[retryIdx + 1]) {
    const value = parseInt(argv[retryIdx + 1], 10);
    if (!isNaN(value) && value >= 0) {
      currentContext.retry = value;
    }
  }

  // Parse --on-conflict value
  const conflictIdx = argv.findIndex((arg) => arg === "--on-conflict");
  if (conflictIdx !== -1 && argv[conflictIdx + 1]) {
    const value = argv[conflictIdx + 1] as "fail" | "skip" | "suffix";
    if (["fail", "skip", "suffix"].includes(value)) {
      currentContext.onConflict = value;
    }
  }

  // Environment variable overrides
  if (process.env.RENAMED_JSON === "1" || process.env.RENAMED_JSON === "true") {
    currentContext.json = true;
    currentContext.quiet = true;
  }

  if (process.env.RENAMED_QUIET === "1" || process.env.RENAMED_QUIET === "true") {
    currentContext.quiet = true;
  }

  if (process.env.RENAMED_YES === "1" || process.env.RENAMED_YES === "true") {
    currentContext.yes = true;
  }

  if (process.env.CI || process.env.RENAMED_NO_INPUT === "1") {
    currentContext.noInput = true;
    currentContext.yes = true;
  }

  if (process.env.RENAMED_TIMEOUT) {
    const value = parseInt(process.env.RENAMED_TIMEOUT, 10);
    if (!isNaN(value) && value > 0) {
      currentContext.timeout = value;
    }
  }

  if (process.env.RENAMED_RETRY) {
    const value = parseInt(process.env.RENAMED_RETRY, 10);
    if (!isNaN(value) && value >= 0) {
      currentContext.retry = value;
    }
  }

  return currentContext;
}

/**
 * Get the current CLI context.
 */
export function getContext(): CLIContext {
  return currentContext;
}

/**
 * Check if we're in JSON output mode.
 */
export function isJsonMode(): boolean {
  return currentContext.json;
}

/**
 * Check if we're in quiet mode (no spinners/progress).
 */
export function isQuietMode(): boolean {
  return currentContext.quiet;
}

/**
 * Check if we should skip confirmations.
 */
export function shouldAutoConfirm(): boolean {
  return currentContext.yes;
}

/**
 * Check if we're in non-interactive mode.
 */
export function isNonInteractive(): boolean {
  return currentContext.noInput || !process.stdout.isTTY;
}

/**
 * Get the request timeout in milliseconds.
 */
export function getTimeout(): number {
  return currentContext.timeout;
}

/**
 * Get the retry count.
 */
export function getRetryCount(): number {
  return currentContext.retry;
}

/**
 * Get the conflict resolution strategy.
 */
export function getConflictStrategy(): "fail" | "skip" | "suffix" {
  return currentContext.onConflict;
}

/**
 * Reset context to defaults (for testing).
 */
export function resetContext(): void {
  currentContext = { ...DEFAULT_CONTEXT };
}
