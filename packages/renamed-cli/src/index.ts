import { Command, CommanderError } from "commander";
import chalk from "chalk";
import pkg from "../package.json" assert { type: "json" };
import { createApiClient } from "./lib/api-client.js";
import { registerAuthCommands } from "./modules/auth.js";
import { registerRenameCommands } from "./modules/rename.js";
import { registerExtractCommands } from "./modules/extract.js";
import { registerPdfSplitCommands } from "./modules/pdf-split.js";
import { registerWatchCommands } from "./modules/watch.js";
import { registerConfigCommands } from "./modules/config-cmd.js";
import { registerDoctorCommand } from "./modules/doctor.js";
import { registerUpdateCommand } from "./modules/update.js";
import { renderUnknownError, CLIError, missingArgument } from "./lib/errors/index.js";
import { initContext, isJsonMode, isQuietMode } from "./lib/cli-context.js";
import { outputError } from "./lib/json-output.js";
import { checkForUpdateQuietly } from "./lib/version-check.js";

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
    "renamed auth login",
    "renamed auth whoami",
  ],
};

/**
 * Check if we should show the welcome message (no command provided).
 */
function shouldShowWelcome(argv: string[]): boolean {
  // Check for flags that should show help or version instead
  const args = argv.slice(2);
  if (args.length === 0) return true;

  // If only flags like --help, --version, -h, -V, let Commander handle them
  const hasOnlyFlags = args.every((arg) => arg.startsWith("-"));
  if (hasOnlyFlags) return false;

  // "help" command should show help
  if (args[0] === "help") return false;

  return false;
}

/**
 * Display a friendly welcome message for first-time users.
 */
function showWelcome(): void {
  console.log(`
${chalk.bold.cyan("Welcome to renamed.to CLI!")} ${chalk.dim(`v${pkg.version}`)}

${chalk.bold("Quick Start:")}
  ${chalk.yellow("1.")} Authenticate:    ${chalk.cyan("renamed auth login")}
  ${chalk.yellow("2.")} Rename a file:   ${chalk.cyan("renamed rename invoice.pdf")}
  ${chalk.yellow("3.")} Apply changes:   ${chalk.cyan("renamed rename -a invoice.pdf")}

${chalk.bold("Common Commands:")}
  ${chalk.cyan("renamed rename")} ${chalk.dim("<file>")}      AI-powered file renaming
  ${chalk.cyan("renamed extract")} ${chalk.dim("<file>")}     Extract structured data from PDFs
  ${chalk.cyan("renamed watch")} ${chalk.dim("<dir>")}        Watch folder for automatic renaming
  ${chalk.cyan("renamed auth login")}        Authenticate (opens browser)

Run ${chalk.cyan("renamed --help")} for all commands and options.
Run ${chalk.cyan("renamed <command> --help")} for command-specific help.

${chalk.dim("Docs:")} ${chalk.blue.underline("https://www.renamed.to/docs/cli")}
`);
}

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

/**
 * Show update notification if a newer version is available.
 * Only shows in interactive mode (not JSON, not quiet, TTY output).
 */
async function showUpdateNotification(): Promise<void> {
  // Skip in non-interactive modes
  if (isJsonMode() || isQuietMode() || !process.stdout.isTTY) {
    return;
  }

  const updateInfo = await checkForUpdateQuietly();
  if (updateInfo) {
    console.log();
    console.log(
      chalk.dim(
        `Update available: ${updateInfo.currentVersion} → ${updateInfo.latestVersion}`
      )
    );
    console.log(chalk.dim(`Run: ${updateInfo.updateCommand}`));
  }
}

export async function main(argv = process.argv): Promise<void> {
  // Initialize CLI context from arguments and environment
  initContext(argv);

  // Show welcome message if no arguments provided
  if (shouldShowWelcome(argv)) {
    showWelcome();
    return; // Exit 0 - this is expected behavior
  }

  const program = new Command()
    .name("renamed")
    .description("Official renamed.to CLI")
    .version(pkg.version)
    .option("--json", "Output results as JSON (machine-readable)")
    .option("-q, --quiet", "Suppress progress indicators and spinners")
    .option("-y, --yes", "Skip confirmation prompts (auto-confirm)")
    .option("--no-input", "Fail instead of prompting for input (CI mode)")
    .option("--timeout <ms>", "Request timeout in milliseconds", "30000")
    .option("--retry <count>", "Number of retry attempts for failed requests", "2")
    .option("--on-conflict <strategy>", "Conflict resolution: fail, skip, or suffix", "fail")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("Quick Start:")}
  ${chalk.yellow("1.")} ${chalk.cyan("renamed auth login")}         ${chalk.gray("Authenticate (opens browser)")}
  ${chalk.yellow("2.")} ${chalk.cyan("renamed rename invoice.pdf")} ${chalk.gray("Preview AI-suggested filename")}
  ${chalk.yellow("3.")} ${chalk.cyan("renamed rename -a *.pdf")}    ${chalk.gray("Apply renames to all PDFs")}

${chalk.bold.cyan("Common Workflows:")}
  ${chalk.cyan("renamed extract invoice.pdf")}      ${chalk.gray("Extract structured data")}
  ${chalk.cyan("renamed watch ~/Downloads")}        ${chalk.gray("Auto-rename new files")}
  ${chalk.cyan("renamed pdf-split document.pdf")}   ${chalk.gray("Split PDF into pages")}
  ${chalk.cyan("renamed doctor")}                   ${chalk.gray("Check system and auth status")}

${chalk.bold.cyan("Global Options:")}
  ${chalk.cyan("--json")}                           ${chalk.gray("Machine-readable JSON output")}
  ${chalk.cyan("--quiet, -q")}                      ${chalk.gray("Suppress spinners and progress")}
  ${chalk.cyan("--yes, -y")}                        ${chalk.gray("Skip confirmation prompts")}
  ${chalk.cyan("--no-input")}                       ${chalk.gray("Fail instead of prompting (CI)")}
  ${chalk.cyan("--timeout <ms>")}                   ${chalk.gray("Request timeout (default: 30000)")}
  ${chalk.cyan("--retry <count>")}                  ${chalk.gray("Retry attempts (default: 2)")}
  ${chalk.cyan("--on-conflict <strategy>")}         ${chalk.gray("Handle conflicts: fail|skip|suffix")}

${chalk.bold.cyan("Environment Variables:")}
  ${chalk.cyan("RENAMED_TOKEN")}                    ${chalk.gray("API token (overrides keychain)")}
  ${chalk.cyan("RENAMED_JSON=1")}                   ${chalk.gray("Enable JSON output")}
  ${chalk.cyan("RENAMED_QUIET=1")}                  ${chalk.gray("Enable quiet mode")}
  ${chalk.cyan("CI=1")}                             ${chalk.gray("Enable non-interactive mode")}

${chalk.dim("Docs:")} ${chalk.blue.underline("https://www.renamed.to/docs/cli")}
`
    );

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
  registerDoctorCommand(program, api);
  registerUpdateCommand(program);

  try {
    await program.parseAsync(argv);

    // Show update notification in interactive mode (after successful command)
    await showUpdateNotification();
  } catch (error) {
    // Handle Commander-specific errors
    if (error instanceof CommanderError) {
      // Help and version should exit 0 (not errors)
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return;
      }
      const cliError = handleCommanderError(error, argv);
      if (isJsonMode()) {
        outputError(cliError, { version: pkg.version });
      } else {
        renderUnknownError(cliError);
      }
      process.exitCode = 1;
    } else {
      if (isJsonMode()) {
        outputError(error instanceof Error ? error : new Error(String(error)), { version: pkg.version });
      } else {
        renderUnknownError(error);
      }
      process.exitCode = 1;
    }
  }
}

void main();
