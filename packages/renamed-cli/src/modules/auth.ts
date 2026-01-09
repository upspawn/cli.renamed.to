import { Command } from "commander";
import prompts from "prompts";
import chalk from "chalk";
import type { ApiClient } from "../lib/api-client.js";
import { ConfTokenStore } from "../lib/api-client.js";
import { runDeviceAuth } from "./device-flow.js";
import { isCLIError, renderError } from "../lib/errors/index.js";
import { createSpinner } from "../lib/spinner.js";
import { isJsonMode, isNonInteractive } from "../lib/cli-context.js";
import { outputSuccess, outputError, type AuthStatusJson } from "../lib/json-output.js";

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
  ${chalk.yellow("login")}    OAuth authentication - opens browser ${chalk.green("(recommended)")}
  ${chalk.yellow("token")}    Manual API token entry (advanced)

${chalk.bold.cyan("Commands:")}
  ${chalk.yellow("login")}    Authenticate via browser (opens automatically)
  ${chalk.yellow("token")}    Store an API token manually
  ${chalk.yellow("whoami")}   Show current authenticated user
  ${chalk.yellow("logout")}   Remove stored credentials

${chalk.bold.cyan("Examples:")}
  renamed auth login
      ${chalk.gray("Opens browser to authenticate (recommended)")}

  renamed auth whoami
      ${chalk.gray("Check who you're logged in as")}

  renamed auth logout
      ${chalk.gray("Sign out and clear stored credentials")}

${chalk.dim("Don't have an account?")} ${chalk.blue.underline("https://www.renamed.to/sign-up")}
`
    );

  auth
    .command("token")
    .description("Store an API token manually (advanced)")
    .option("-t, --token <token>", "Personal API token")
    .option("-s, --scheme <scheme>", "Authorization scheme (default: Bearer)")
    .option("--non-interactive", "Fail instead of prompting for input", false)
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("Get your API token:")}
  ${chalk.blue.underline("https://www.renamed.to/settings/api")}

${chalk.bold.cyan("Examples:")}
  renamed auth token                    ${chalk.gray("# Interactive token prompt")}
  renamed auth token -t YOUR_TOKEN      ${chalk.gray("# Provide token directly")}

${chalk.dim("Tip: Use")} ${chalk.cyan("renamed auth login")} ${chalk.dim("for easier browser-based authentication.")}
`
    )
    .action(async (options: LoginOptions) => {
      const spinner = createSpinner("Saving credentials").start();
      try {
        const token = await resolveToken(options);
        api.setLegacyToken(token, options.scheme);
        spinner.succeed("Token saved locally");
        if (isJsonMode()) {
          outputSuccess({ saved: true });
        }
      } catch (error) {
        spinner.fail("Token save failed");
        if (isJsonMode()) {
          outputError(error instanceof Error ? error : new Error(String(error)));
        } else {
          console.error(chalk.red((error as Error).message));
        }
        process.exitCode = 1;
      }
    });

  auth
    .command("logout")
    .description("Remove locally stored credentials")
    .action(() => {
      api.clearToken();
      if (isJsonMode()) {
        outputSuccess({ signedOut: true });
      } else {
        console.log(chalk.green("Signed out locally."));
      }
    });

  auth
    .command("whoami")
    .description("Show the current authenticated account")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("Examples:")}
  renamed auth whoami          ${chalk.gray("# Show account info")}
  renamed auth whoami --json   ${chalk.gray("# Output as JSON")}
`
    )
    .action(async () => {
      const spinner = createSpinner("Fetching profile").start();
      const tokenStore = new ConfTokenStore();
      const tokens = tokenStore.getTokens();

      try {
        const profile = await api.get<{ id: string; email?: string; name?: string }>("/user");
        spinner.stop();

        if (isJsonMode()) {
          const result: AuthStatusJson = {
            authenticated: true,
            user: {
              id: profile.id,
              ...(profile.email && { email: profile.email }),
              ...(profile.name && { name: profile.name }),
            },
            token: {
              ...(tokens.expiresAt && { expiresAt: new Date(tokens.expiresAt).toISOString() }),
              ...(tokens.scope && { scope: tokens.scope }),
              ...(tokens.tokenType && { type: tokens.tokenType }),
            },
          };
          outputSuccess(result);
        } else {
          console.log(chalk.cyan(`ID: ${profile.id}`));
          if (profile.email) console.log(chalk.cyan(`Email: ${profile.email}`));
          if (profile.name) console.log(chalk.cyan(`Name: ${profile.name}`));
          if (tokens.expiresAt) {
            const expiresAt = new Date(tokens.expiresAt);
            console.log(chalk.dim(`Token expires: ${expiresAt.toLocaleString()}`));
          }
        }
      } catch (error) {
        spinner.stop();
        if (isJsonMode()) {
          const result: AuthStatusJson = {
            authenticated: false,
          };
          if (isCLIError(error)) {
            outputError(error);
          } else {
            outputSuccess(result);
          }
        } else {
          if (isCLIError(error)) {
            renderError(error);
          } else {
            console.error(chalk.red((error as Error).message));
          }
        }
        process.exitCode = 1;
      }
    });

  // Default client ID for the official renamed.to CLI (public client - no secret needed)
  const DEFAULT_CLIENT_ID = "a1ba13513768aa666a5280e7be8836b6";

  auth
    .command("login")
    .description("Authenticate via browser (recommended)")
    .option("--client-id <id>", "OAuth client ID", process.env.RENAMED_CLIENT_ID ?? DEFAULT_CLIENT_ID)
    .option("--client-secret <secret>", "OAuth client secret", process.env.RENAMED_CLIENT_SECRET)
    .option("--base-url <url>", "OAuth base URL", "https://www.renamed.to")
    .option("--scope <scope>", "Requested scope", "read write upload process")
    .option("--no-open", "Do not automatically open a browser")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("How it works:")}
  1. Opens your browser to www.renamed.to
  2. Log in or create an account
  3. Authorize the CLI
  4. You're authenticated!

${chalk.bold.cyan("Examples:")}
  renamed auth login           ${chalk.gray("# Opens browser to authenticate")}
  renamed auth login --no-open ${chalk.gray("# Manual: copy URL to browser")}

${chalk.dim("Don't have an account?")} ${chalk.blue.underline("https://www.renamed.to/sign-up")}
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
        console.log(chalk.green("Successfully authenticated!"));
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}

export async function resolveToken(options: LoginOptions): Promise<string> {
  if (options.token) return options.token;
  if (options.nonInteractive || isNonInteractive()) {
    throw new Error("No token supplied and interactive prompts disabled.");
  }

  if (!isJsonMode()) {
    console.log(chalk.dim(`\nGet your API token from: ${chalk.blue.underline("https://www.renamed.to/settings/api")}\n`));
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
