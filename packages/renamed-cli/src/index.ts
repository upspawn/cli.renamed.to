import { Command, CommanderError } from "commander";
import pkg from "../package.json" assert { type: "json" };
import { createApiClient } from "./lib/api-client.js";
import { registerAuthCommands } from "./modules/auth.js";
import { registerRenameCommands } from "./modules/rename.js";
import { registerExtractCommands } from "./modules/extract.js";
import { registerPdfSplitCommands } from "./modules/pdf-split.js";
import { registerWatchCommands } from "./modules/watch.js";
import { registerConfigCommands } from "./modules/config-cmd.js";
import { renderUnknownError, CLIError, missingArgument } from "./lib/errors/index.js";

// Command examples for contextual help
const COMMAND_EXAMPLES: Record<string, string[]> = {
  rename: [
    "renamed rename invoice.pdf",
    'renamed rename -p "YYYY-MM-DD_company" invoice.pdf',
  ],
  extract: [
    "renamed extract invoice.pdf",
    "renamed extract invoice.pdf -o json",
  ],
  "pdf-split": [
    "renamed pdf-split document.pdf --wait",
    "renamed pdf-split doc.pdf -m every-n-pages -n 10",
  ],
  watch: [
    "renamed watch ~/Downloads -o ~/Documents",
    "renamed watch ~/inbox --dry-run",
  ],
  auth: [
    "renamed auth device",
    "renamed auth whoami",
  ],
};

/**
 * Extract command name from argv.
 */
function extractCommandFromArgv(argv: string[]): string | undefined {
  // Skip 'node' and script path, find first non-option argument
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      return arg;
    }
  }
  return undefined;
}

/**
 * Parse Commander error messages and convert to CLIError.
 */
function handleCommanderError(error: CommanderError, argv: string[]): CLIError {
  const message = error.message;
  const command = extractCommandFromArgv(argv);
  const examples = command ? COMMAND_EXAMPLES[command] : undefined;

  // Missing required argument: error: missing required argument 'files'
  const missingArgMatch = message.match(/missing required argument '([^']+)'/);
  if (missingArgMatch) {
    const argName = missingArgMatch[1];
    const commandName = command || "command";
    const example = examples?.[0];
    const usage = `renamed ${commandName} <${argName}>`;
    return missingArgument(argName, commandName, usage, examples);
  }

  // Unknown command
  if (message.includes("unknown command")) {
    return new CLIError("VALIDATION_INVALID_OPTION", message, {
      suggestion: "Run `renamed --help` to see available commands",
    });
  }

  // Unknown option
  const unknownOptionMatch = message.match(/unknown option '([^']+)'/);
  if (unknownOptionMatch) {
    const suggestion = command
      ? `Run \`renamed ${command} --help\` to see available options`
      : "Run `renamed <command> --help` to see available options";
    return new CLIError("VALIDATION_INVALID_OPTION", message, { suggestion });
  }

  // Default: wrap as unknown error
  return new CLIError("UNKNOWN_ERROR", message);
}

export async function main(argv = process.argv): Promise<void> {
  const program = new Command()
    .name("renamed")
    .description("Official renamed.to CLI")
    .version(pkg.version);

  // Configure Commander to throw errors instead of exiting
  program.exitOverride();

  // Custom error output handler
  program.configureOutput({
    writeErr: () => {
      // Suppress default error output - we handle it ourselves
    },
  });

  const api = createApiClient();

  registerAuthCommands(program, api);
  registerRenameCommands(program, api);
  registerExtractCommands(program, api);
  registerPdfSplitCommands(program, api);
  registerWatchCommands(program, api);
  registerConfigCommands(program);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    // Handle Commander-specific errors
    if (error instanceof CommanderError) {
      // Don't show error for --help or --version
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return;
      }
      const cliError = handleCommanderError(error, argv);
      renderUnknownError(cliError);
    } else {
      renderUnknownError(error);
    }
    process.exitCode = 1;
  }
}

void main();
