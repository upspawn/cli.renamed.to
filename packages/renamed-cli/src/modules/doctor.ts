/**
 * Doctor command - diagnostics and health check.
 * Verifies system configuration, network connectivity, and auth status.
 */

import { Command } from "commander";
import chalk from "chalk";
import os from "os";
import pkg from "../../package.json" assert { type: "json" };
import type { ApiClient } from "../lib/api-client.js";
import { createSpinner } from "../lib/spinner.js";
import { isJsonMode } from "../lib/cli-context.js";
import { outputSuccess, type DoctorResultJson } from "../lib/json-output.js";
import { ConfTokenStore } from "../lib/api-client.js";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: string;
}

export function registerDoctorCommand(program: Command, api: ApiClient): void {
  program
    .command("doctor")
    .description("Check system configuration and connectivity")
    .option("--verbose", "Show detailed diagnostic information")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("What it checks:")}
  ${chalk.yellow("•")} Node.js version compatibility
  ${chalk.yellow("•")} Network connectivity to renamed.to
  ${chalk.yellow("•")} Authentication status and token expiry
  ${chalk.yellow("•")} Configuration file validity

${chalk.bold.cyan("Examples:")}
  renamed doctor              ${chalk.gray("Run all diagnostic checks")}
  renamed doctor --verbose    ${chalk.gray("Show detailed information")}
  renamed doctor --json       ${chalk.gray("Output as JSON for scripting")}
`
    )
    .action(async (options: { verbose?: boolean }) => {
      await runDoctor(api, options.verbose ?? false);
    });
}

async function runDoctor(api: ApiClient, verbose: boolean): Promise<void> {
  const spinner = createSpinner("Running diagnostics...").start();
  const checks: CheckResult[] = [];

  // System checks
  const nodeVersion = process.version;
  const nodeVersionNum = parseInt(nodeVersion.slice(1).split(".")[0], 10);

  if (nodeVersionNum >= 18) {
    checks.push({
      name: "Node.js version",
      status: "pass",
      message: `Node.js ${nodeVersion}`,
    });
  } else {
    checks.push({
      name: "Node.js version",
      status: "fail",
      message: `Node.js ${nodeVersion} (requires >= 18)`,
      details: "Upgrade Node.js to version 18 or higher",
    });
  }

  // Network check
  const baseUrl = "https://www.renamed.to";
  let networkReachable = false;
  let networkLatency: number | undefined;

  try {
    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    networkLatency = Date.now() - startTime;
    networkReachable = response.ok || response.status === 404; // 404 is fine, server is reachable

    if (networkReachable) {
      checks.push({
        name: "Network connectivity",
        status: "pass",
        message: `Connected to ${baseUrl} (${networkLatency}ms)`,
      });
    } else {
      checks.push({
        name: "Network connectivity",
        status: "fail",
        message: `Server returned ${response.status}`,
        details: "The API may be temporarily unavailable",
      });
    }
  } catch (error) {
    checks.push({
      name: "Network connectivity",
      status: "fail",
      message: `Cannot connect to ${baseUrl}`,
      details: error instanceof Error ? error.message : "Network error",
    });
  }

  // Auth check
  const tokenStore = new ConfTokenStore();
  const tokens = tokenStore.getTokens();
  const authStatus = {
    hasCredentials: false,
    tokenExpiry: undefined as string | undefined,
  };

  if (tokens.accessToken) {
    authStatus.hasCredentials = true;

    if (tokens.expiresAt) {
      const expiresAt = new Date(tokens.expiresAt);
      authStatus.tokenExpiry = expiresAt.toISOString();
      const now = Date.now();

      if (tokens.expiresAt > now + 24 * 60 * 60 * 1000) {
        // More than 24 hours left
        checks.push({
          name: "Authentication",
          status: "pass",
          message: "Authenticated",
          details: `Token expires ${expiresAt.toLocaleDateString()}`,
        });
      } else if (tokens.expiresAt > now) {
        // Less than 24 hours left
        checks.push({
          name: "Authentication",
          status: "warn",
          message: "Token expiring soon",
          details: `Expires ${expiresAt.toLocaleString()}. Run: renamed auth login`,
        });
      } else {
        // Expired
        checks.push({
          name: "Authentication",
          status: "fail",
          message: "Token expired",
          details: "Run: renamed auth login",
        });
      }
    } else {
      checks.push({
        name: "Authentication",
        status: "pass",
        message: "Authenticated (no expiry info)",
      });
    }

    // Verify token with API
    try {
      spinner.text = "Verifying authentication...";
      await api.get("/user");
      checks.push({
        name: "Token validation",
        status: "pass",
        message: "Token is valid",
      });
    } catch {
      checks.push({
        name: "Token validation",
        status: "fail",
        message: "Token validation failed",
        details: "Token may be revoked. Run: renamed auth login",
      });
    }
  } else {
    checks.push({
      name: "Authentication",
      status: "warn",
      message: "Not authenticated",
      details: "Run: renamed auth login",
    });
  }

  // Environment variable check
  if (process.env.RENAMED_TOKEN) {
    checks.push({
      name: "Environment",
      status: "pass",
      message: "RENAMED_TOKEN is set",
    });
  }

  spinner.stop();

  // Output results
  const result: DoctorResultJson = {
    checks: checks.map((c) => ({
      name: c.name,
      status: c.status,
      message: c.message,
      ...(c.details && { details: c.details }),
    })),
    system: {
      os: `${os.platform()} ${os.release()}`,
      nodeVersion: process.version,
      cliVersion: pkg.version,
    },
    network: {
      baseUrl,
      reachable: networkReachable,
      ...(networkLatency && { latencyMs: networkLatency }),
    },
    auth: authStatus,
  };

  if (isJsonMode()) {
    outputSuccess(result);
    return;
  }

  // Human-readable output
  console.log("");
  console.log(chalk.bold.cyan("Diagnostics Report"));
  console.log(chalk.dim("─".repeat(50)));

  for (const check of checks) {
    const icon = check.status === "pass" ? chalk.green("✓") :
                 check.status === "warn" ? chalk.yellow("⚠") :
                 chalk.red("✗");
    console.log(`${icon} ${chalk.bold(check.name)}: ${check.message}`);
    if (verbose && check.details) {
      console.log(chalk.dim(`    ${check.details}`));
    }
  }

  console.log("");
  console.log(chalk.dim("─".repeat(50)));
  console.log(chalk.bold("System Information:"));
  console.log(`  OS: ${os.platform()} ${os.release()}`);
  console.log(`  Node.js: ${process.version}`);
  console.log(`  CLI: v${pkg.version}`);
  console.log(`  API: ${baseUrl}`);

  // Summary
  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  console.log("");
  if (failCount > 0) {
    console.log(chalk.red(`✗ ${failCount} check(s) failed`));
    process.exitCode = 1;
  } else if (warnCount > 0) {
    console.log(chalk.yellow(`⚠ ${passCount} passed, ${warnCount} warning(s)`));
  } else {
    console.log(chalk.green(`✓ All ${passCount} checks passed`));
  }

  // Show details for failures/warnings if not verbose
  if (!verbose && (failCount > 0 || warnCount > 0)) {
    console.log(chalk.dim("\nRun with --verbose for more details"));
  }
}
