/**
 * Update command - check for CLI updates and show upgrade instructions.
 */

import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../lib/spinner.js";
import { isJsonMode } from "../lib/cli-context.js";
import { outputSuccess } from "../lib/json-output.js";
import {
  getCurrentVersion,
  fetchLatestVersion,
  isNewerVersion,
  detectInstallMethod,
  getUpdateCommand,
  VersionCheckStore,
  type InstallMethod,
} from "../lib/version-check.js";

interface UpdateResultJson {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  installMethod: InstallMethod;
  updateCommand: string;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for CLI updates and show upgrade instructions")
    .option("--check", "Only check for updates, don't show upgrade instructions")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("What it does:")}
  ${chalk.yellow("•")} Checks the npm registry for the latest version
  ${chalk.yellow("•")} Detects your installation method (npm, pnpm, homebrew, binary)
  ${chalk.yellow("•")} Shows the appropriate update command

${chalk.bold.cyan("Examples:")}
  renamed update          ${chalk.gray("Check for updates and show upgrade instructions")}
  renamed update --check  ${chalk.gray("Only check if an update is available")}
  renamed update --json   ${chalk.gray("Output as JSON for scripting")}
`
    )
    .action(async (options: { check?: boolean }) => {
      await runUpdate(options.check ?? false);
    });
}

async function runUpdate(checkOnly: boolean): Promise<void> {
  const spinner = createSpinner("Checking for updates...").start();

  const currentVersion = getCurrentVersion();
  const installMethod = detectInstallMethod();
  const updateCommand = getUpdateCommand(installMethod);

  let latestVersion: string;

  try {
    latestVersion = await fetchLatestVersion();
    // Update the cache
    const store = new VersionCheckStore();
    store.setCache(latestVersion);
  } catch {
    spinner.fail("Failed to check for updates");
    if (!isJsonMode()) {
      console.log(
        chalk.yellow("\nCouldn't reach the npm registry. Check your network connection.")
      );
    }
    process.exitCode = 1;
    return;
  }

  const updateAvailable = isNewerVersion(currentVersion, latestVersion);

  // JSON output
  if (isJsonMode()) {
    spinner.stop();
    const result: UpdateResultJson = {
      currentVersion,
      latestVersion,
      updateAvailable,
      installMethod,
      updateCommand,
    };
    outputSuccess(result);
    return;
  }

  // Human-readable output
  if (updateAvailable) {
    spinner.succeed("Update available!");
    console.log();
    console.log(
      `  ${chalk.gray("Current version:")} ${chalk.yellow(currentVersion)}`
    );
    console.log(
      `  ${chalk.gray("Latest version:")}  ${chalk.green(latestVersion)}`
    );
    console.log();

    if (!checkOnly) {
      console.log(
        `  ${chalk.gray("Install method:")}  ${chalk.cyan(formatInstallMethod(installMethod))}`
      );
      console.log();
      console.log(chalk.bold("To update, run:"));
      console.log();
      console.log(`  ${chalk.cyan(updateCommand)}`);
      console.log();
    }
  } else {
    spinner.succeed("You're up to date!");
    console.log();
    console.log(
      `  ${chalk.gray("Current version:")} ${chalk.green(currentVersion)}`
    );
    console.log(
      `  ${chalk.gray("Latest version:")}  ${chalk.green(latestVersion)}`
    );
    console.log();
  }
}

function formatInstallMethod(method: InstallMethod): string {
  switch (method) {
    case "npm":
      return "npm (global)";
    case "pnpm":
      return "pnpm (global)";
    case "homebrew":
      return "Homebrew";
    case "binary":
      return "Standalone binary";
    default:
      return "Unknown";
  }
}
