import { Command } from "commander";
import prompts from "prompts";
import chalk from "chalk";
import ora from "ora";
import type { ApiClient } from "../lib/api-client.js";
import { runDeviceAuth } from "./device-flow.js";
import { isCLIError, renderError } from "../lib/errors/index.js";

export interface LoginOptions {
  token?: string;
  scheme?: string;
  nonInteractive?: boolean;
}

export function registerAuthCommands(program: Command, api: ApiClient): void {
  const auth = program
    .command("auth")
    .description("Manage renamed.to authentication")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("Authentication Methods:")}
  ${chalk.yellow("device")}   OAuth device flow - opens browser ${chalk.green("(recommended)")}
  ${chalk.yellow("login")}    Manual API token entry

${chalk.bold.cyan("Commands:")}
  ${chalk.yellow("device")}   Authenticate via browser (opens automatically)
  ${chalk.yellow("login")}    Store an API token manually
  ${chalk.yellow("whoami")}   Show current authenticated user
  ${chalk.yellow("logout")}   Remove stored credentials

${chalk.bold.cyan("Examples:")}
  renamed auth device
      ${chalk.gray("Opens browser to authenticate (recommended)")}

  renamed auth whoami
      ${chalk.gray("Check who you're logged in as")}

  renamed auth logout
      ${chalk.gray("Sign out and clear stored credentials")}
`
    );

  auth
    .command("login")
    .description("Store an API token for future requests")
    .option("-t, --token <token>", "Personal API token")
    .option("-s, --scheme <scheme>", "Authorization scheme (default: Bearer)")
    .option("--non-interactive", "Fail instead of prompting for input", false)
    .addHelpText(
      "after",
      `
Examples:
  $ renamed auth login                    # Interactive token prompt
  $ renamed auth login -t YOUR_TOKEN      # Provide token directly
`
    )
    .action(async (options: LoginOptions) => {
      const spinner = ora("Saving credentials").start();
      try {
        const token = await resolveToken(options);
        api.setLegacyToken(token, options.scheme);
        spinner.succeed("Token saved locally");
      } catch (error) {
        spinner.fail("Login failed");
        console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });

  auth
    .command("logout")
    .description("Remove locally stored credentials")
    .action(() => {
      api.clearToken();
      console.log(chalk.green("Signed out locally."));
    });

  auth
    .command("whoami")
    .description("Show the current authenticated account")
    .action(async () => {
      const spinner = ora("Fetching profile").start();
      try {
        const profile = await api.get<{ id: string; email?: string; name?: string }>("/user");
        spinner.stop();
        console.log(chalk.cyan(`ID: ${profile.id}`));
        if (profile.email) console.log(chalk.cyan(`Email: ${profile.email}`));
        if (profile.name) console.log(chalk.cyan(`Name: ${profile.name}`));
      } catch (error) {
        spinner.stop();
        if (isCLIError(error)) {
          renderError(error);
        } else {
          console.error(chalk.red((error as Error).message));
        }
        process.exitCode = 1;
      }
    });

  // Default client ID for the official renamed.to CLI (public client - no secret needed)
  const DEFAULT_CLIENT_ID = "a1ba13513768aa666a5280e7be8836b6";

  auth
    .command("device")
    .description("Authenticate using OAuth device authorization (recommended)")
    .option("--client-id <id>", "OAuth client ID", process.env.RENAMED_CLIENT_ID ?? DEFAULT_CLIENT_ID)
    .option("--client-secret <secret>", "OAuth client secret", process.env.RENAMED_CLIENT_SECRET)
    .option("--base-url <url>", "OAuth base URL", "https://www.renamed.to")
    .option("--scope <scope>", "Requested scope", "read write upload process")
    .option("--no-open", "Do not automatically open a browser")
    .addHelpText(
      "after",
      `
Examples:
  $ renamed auth device           # Opens browser to authenticate
  $ renamed auth device --no-open # Manual browser authentication
`
    )
    .action(async (options) => {
      const clientId = options.clientId;
      if (!clientId) {
        console.error(
          chalk.red("Client ID is required. Provide --client-id or set RENAMED_CLIENT_ID.")
        );
        process.exitCode = 1;
        return;
      }

      try {
        const tokens = await runDeviceAuth({
          clientId,
          clientSecret: options.clientSecret,
          baseUrl: options.baseUrl,
          scope: options.scope,
          pollInterval: 5,
          openBrowser: options.open
        });

        api.storeOAuthTokens(tokens);
        console.log(chalk.green("Device authorization successful."));
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}

export async function resolveToken(options: LoginOptions): Promise<string> {
  if (options.token) return options.token;
  if (options.nonInteractive) {
    throw new Error("No token supplied and interactive prompts disabled.");
  }

  const { token } = await prompts({
    type: "password",
    name: "token",
    message: "Paste your renamed.to API token"
  });

  if (!token) {
    throw new Error("Token is required.");
  }

  return token;
}
