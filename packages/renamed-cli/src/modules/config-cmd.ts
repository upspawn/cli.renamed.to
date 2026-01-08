import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import chalk from "chalk";
import {
  loadConfig,
  loadConfigFile,
  USER_CONFIG_PATH,
  SYSTEM_CONFIG_PATH,
} from "../lib/config.js";

// ---------------------------------------------------------------------------
// Example Configuration Content
// ---------------------------------------------------------------------------

const EXAMPLE_CONFIG = `# renamed.to CLI Configuration
# Place at ~/.config/renamed/config.yaml (user) or /etc/renamed/config.yaml (system)
#
# Configuration precedence (highest to lowest):
# 1. CLI flags
# 2. User config (~/.config/renamed/config.yaml)
# 3. System config (/etc/renamed/config.yaml)
# 4. Built-in defaults

# Watch mode settings
watch:
  # Default file patterns to process
  patterns:
    - "*.pdf"
    - "*.jpg"
    - "*.jpeg"
    - "*.png"
    - "*.tiff"
    - "*.tif"

  # Default output directory (can be overridden with --output-dir)
  # outputDir: "/path/to/organized"

  # Default failed directory (can be overridden with --failed-dir)
  # failedDir: "/path/to/failed"

# Rate limiting and processing
rateLimit:
  # Maximum concurrent file processing (1-10)
  concurrency: 2

  # Debounce delay for batch file drops (ms)
  # Waits this long after the last file event before processing
  debounceMs: 1000

  # Number of retry attempts for failed files
  retryAttempts: 3

  # Base delay between retries (exponential backoff applied)
  retryDelayMs: 5000

# Health check settings
health:
  # Enable Unix socket health endpoint
  enabled: true

  # Socket path for health checks
  # Query with: echo "" | nc -U /tmp/renamed-health.sock
  socketPath: "/tmp/renamed-health.sock"

# Logging configuration
logging:
  # Log level: debug, info, warn, error
  level: info

  # Output JSON logs (recommended for production/systemd)
  json: false
`;

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("Manage renamed.to configuration");

  config
    .command("init")
    .description("Create an example configuration file")
    .option(
      "-g, --global",
      "Create system-wide config at /etc/renamed/config.yaml"
    )
    .action((options: { global?: boolean }) => {
      const targetPath = options.global ? SYSTEM_CONFIG_PATH : USER_CONFIG_PATH;

      if (existsSync(targetPath)) {
        console.error(chalk.yellow(`Config file already exists: ${targetPath}`));
        console.error(
          chalk.gray("Use a text editor to modify it, or delete it first.")
        );
        process.exitCode = 1;
        return;
      }

      try {
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, EXAMPLE_CONFIG, "utf-8");
        console.log(chalk.green(`Created config file: ${targetPath}`));
        console.log(chalk.gray("Edit this file to customize your settings."));
      } catch (error) {
        console.error(
          chalk.red(`Failed to create config: ${(error as Error).message}`)
        );
        if (options.global) {
          console.error(chalk.gray("System config may require sudo."));
        }
        process.exitCode = 1;
      }
    });

  config
    .command("validate")
    .description("Validate configuration file(s)")
    .option("-c, --config <path>", "Specific config file to validate")
    .action((options: { config?: string }) => {
      const pathsToCheck = options.config
        ? [options.config]
        : [SYSTEM_CONFIG_PATH, USER_CONFIG_PATH];

      let hasErrors = false;
      let foundAny = false;

      for (const path of pathsToCheck) {
        if (!existsSync(path)) {
          if (options.config) {
            console.error(chalk.red(`File not found: ${path}`));
            hasErrors = true;
          }
          continue;
        }

        foundAny = true;
        console.log(chalk.cyan(`Checking ${path}...`));

        try {
          loadConfigFile(path);
          console.log(chalk.green(`  ✓ Valid`));
        } catch (error) {
          console.error(chalk.red(`  ✗ Invalid: ${(error as Error).message}`));
          hasErrors = true;
        }
      }

      if (!foundAny && !options.config) {
        console.log(chalk.yellow("No configuration files found."));
        console.log(chalk.gray(`Run 'renamed config init' to create one.`));
      } else if (hasErrors) {
        process.exitCode = 1;
      } else if (foundAny) {
        console.log(chalk.green("\nAll configuration files are valid."));
      }
    });

  config
    .command("show")
    .description("Display the effective configuration")
    .option("-c, --config <path>", "Specific config file to use")
    .action((options: { config?: string }) => {
      try {
        const { config: resolved, sources } = loadConfig(options.config);

        console.log(chalk.cyan("Effective Configuration:"));
        console.log(chalk.gray("─".repeat(40)));

        if (sources.length > 0) {
          console.log(chalk.gray(`Sources: ${sources.join(", ")}`));
        } else {
          console.log(chalk.gray("Sources: (defaults only)"));
        }

        console.log();
        console.log(chalk.bold("Rate Limiting:"));
        console.log(`  concurrency:    ${resolved.concurrency}`);
        console.log(`  debounceMs:     ${resolved.debounceMs}`);
        console.log(`  retryAttempts:  ${resolved.retryAttempts}`);
        console.log(`  retryDelayMs:   ${resolved.retryDelayMs}`);

        console.log();
        console.log(chalk.bold("Health:"));
        console.log(`  enabled:        ${resolved.healthEnabled}`);
        console.log(`  socketPath:     ${resolved.healthSocketPath}`);

        console.log();
        console.log(chalk.bold("Patterns:"));
        for (const pattern of resolved.patterns) {
          console.log(`  - ${pattern}`);
        }

        console.log();
        console.log(chalk.bold("Logging:"));
        console.log(`  level:          ${resolved.logLevel}`);
        console.log(`  json:           ${resolved.logJson}`);
      } catch (error) {
        console.error(
          chalk.red(`Failed to load config: ${(error as Error).message}`)
        );
        process.exitCode = 1;
      }
    });

  config
    .command("path")
    .description("Show configuration file paths")
    .action(() => {
      console.log(chalk.cyan("Configuration file locations:"));
      console.log();
      console.log(chalk.bold("User config:"));
      console.log(`  ${USER_CONFIG_PATH}`);
      console.log(
        `  ${existsSync(USER_CONFIG_PATH) ? chalk.green("(exists)") : chalk.gray("(not found)")}`
      );
      console.log();
      console.log(chalk.bold("System config:"));
      console.log(`  ${SYSTEM_CONFIG_PATH}`);
      console.log(
        `  ${existsSync(SYSTEM_CONFIG_PATH) ? chalk.green("(exists)") : chalk.gray("(not found)")}`
      );
    });
}
