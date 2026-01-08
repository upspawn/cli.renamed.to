import chalk from "chalk";
import { CLIError, isCLIError } from "./types.js";
import { getOutputMode, type OutputMode } from "../output/mode.js";

/**
 * Symbols for error display.
 */
const SYM = {
  error: "✗",
  arrow: "→",
  bullet: "•",
  prompt: "$",
};

/**
 * Get terminal width, with fallback for non-TTY.
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Wrap text to fit within a given width, preserving indentation.
 */
function wrapText(text: string, maxWidth: number, indent: string = ""): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.map((line, i) => (i === 0 ? line : indent + line));
}

/**
 * Render an error in static mode with modern styling.
 */
function renderStaticError(error: CLIError): void {
  const termWidth = Math.min(getTerminalWidth(), 80);
  const output: string[] = [""];

  // Main error line with red X
  const errorLines = wrapText(error.message, termWidth - 4, "  ");
  output.push(`${chalk.red(SYM.error)} ${chalk.red.bold(errorLines[0])}`);
  for (let i = 1; i < errorLines.length; i++) {
    output.push(`  ${chalk.red(errorLines[i])}`);
  }

  // Details in dim text (if present)
  if (error.details) {
    output.push("");
    const detailLines = wrapText(error.details, termWidth - 4, "  ");
    for (const line of detailLines) {
      output.push(`  ${chalk.dim(line)}`);
    }
  }

  // What to do next - the helpful part
  if (error.suggestion || error.example || error.examples?.length) {
    output.push("");

    // Suggestion as a clear next step
    if (error.suggestion) {
      const suggestionLines = wrapText(error.suggestion, termWidth - 4, "  ");
      output.push(`  ${chalk.yellow(SYM.arrow)} ${suggestionLines[0]}`);
      for (let i = 1; i < suggestionLines.length; i++) {
        output.push(`    ${suggestionLines[i]}`);
      }
    }

    // Examples - show multiple if available
    const examples = error.examples?.length ? error.examples : error.example ? [error.example] : [];
    if (examples.length > 0) {
      output.push("");
      if (examples.length === 1) {
        output.push(`  ${chalk.dim("Try:")} ${chalk.cyan(examples[0])}`);
      } else {
        output.push(`  ${chalk.dim("Examples:")}`);
        for (const ex of examples.slice(0, 3)) { // Show up to 3 examples
          output.push(`    ${chalk.cyan(`${SYM.prompt} ${ex}`)}`);
        }
      }
    }
  }

  // Docs link
  if (error.docs) {
    output.push("");
    output.push(`  ${chalk.dim("Docs:")} ${chalk.blue.underline(error.docs)}`);
  }

  output.push("");

  // Output to stderr
  for (const line of output) {
    console.error(line);
  }
}

/**
 * Render an error in JSON mode.
 */
function renderJSONError(error: CLIError): void {
  const output = {
    error: true,
    code: error.code,
    message: error.message,
    suggestion: error.suggestion,
    example: error.example,
    examples: error.examples,
    docs: error.docs,
    details: error.details,
  };

  // Remove undefined values
  const cleaned = Object.fromEntries(
    Object.entries(output).filter(([, v]) => v !== undefined)
  );

  console.error(JSON.stringify(cleaned, null, 2));
}

/**
 * Render an error based on the current output mode.
 */
export function renderError(error: CLIError, mode?: OutputMode): void {
  const outputMode = mode ?? getOutputMode();

  switch (outputMode) {
    case "json":
      renderJSONError(error);
      break;
    case "static":
    case "tui":
      renderStaticError(error);
      break;
  }
}

/**
 * Convert an unknown error to a CLIError and render it.
 */
export function renderUnknownError(error: unknown, mode?: OutputMode): void {
  if (isCLIError(error)) {
    renderError(error, mode);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    const cliError = new CLIError("UNKNOWN_ERROR", message, {
      cause: error instanceof Error ? error : undefined,
    });
    renderError(cliError, mode);
  }
}

// Re-export for convenience
export { CLIError, isCLIError };
