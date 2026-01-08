/**
 * Output mode detection for determining how to render CLI output.
 */

export type OutputMode = "tui" | "static" | "json";

/**
 * Detect the appropriate output mode based on environment and flags.
 *
 * - `tui`: Interactive terminal with OpenTUI components
 * - `static`: Plain text output (for CI, pipes, non-interactive)
 * - `json`: Structured JSON output for scripting
 */
export function getOutputMode(argv: string[] = process.argv): OutputMode {
  // JSON output requested
  if (argv.includes("--json") || argv.includes("-o") && argv.includes("json")) {
    return "json";
  }

  // Explicit non-interactive mode
  if (argv.includes("--non-interactive")) {
    return "static";
  }

  // CI environment
  if (process.env.CI || process.env.RENAMED_NON_INTERACTIVE) {
    return "static";
  }

  // Not a TTY (piped output)
  if (!process.stdout.isTTY) {
    return "static";
  }

  // Dumb terminal
  if (process.env.TERM === "dumb") {
    return "static";
  }

  // Default to TUI for interactive terminals
  return "tui";
}

/**
 * Check if we're in an interactive TTY environment.
 */
export function isInteractive(): boolean {
  return getOutputMode() === "tui";
}
