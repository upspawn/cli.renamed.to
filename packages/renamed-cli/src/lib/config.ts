import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { homedir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** System-wide configuration path (Linux standard) */
export const SYSTEM_CONFIG_PATH = "/etc/renamed/config.yaml";

/** User-level configuration path (XDG Base Directory Specification) */
export const USER_CONFIG_PATH = join(
  homedir(),
  ".config",
  "renamed",
  "config.yaml"
);

/** Default values for all configuration options */
export const CONFIG_DEFAULTS = {
  concurrency: 2,
  debounceMs: 1000,
  retryAttempts: 3,
  retryDelayMs: 5000,
  healthSocketPath: "/tmp/renamed-health.sock",
  patterns: ["*.pdf", "*.jpg", "*.jpeg", "*.png", "*.tiff", "*.tif"],
  usePolling: false,
  pollIntervalMs: 500,
} as const;

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

/** Schema for rate limiting configuration */
const RateLimitSchema = z.object({
  concurrency: z.number().int().min(1).max(10).optional(),
  debounceMs: z.number().int().min(100).max(60000).optional(),
  retryAttempts: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(1000).max(300000).optional(),
  usePolling: z.boolean().optional(),
  pollIntervalMs: z.number().int().min(100).max(10000).optional(),
});

/** Complete configuration file schema */
export const ConfigFileSchema = z.object({
  watch: z
    .object({
      patterns: z.array(z.string()).optional(),
      outputDir: z.string().optional(),
      failedDir: z.string().optional(),
    })
    .optional(),
  rateLimit: RateLimitSchema.optional(),
  health: z
    .object({
      socketPath: z.string().optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).optional(),
      json: z.boolean().optional(),
    })
    .optional(),
});

/** Type derived from the Zod schema */
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** Resolved configuration with all defaults applied */
export interface ResolvedConfig {
  concurrency: number;
  debounceMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  healthSocketPath: string;
  healthEnabled: boolean;
  patterns: string[];
  logLevel: "debug" | "info" | "warn" | "error";
  logJson: boolean;
  usePolling: boolean;
  pollIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Loader Functions
// ---------------------------------------------------------------------------

/**
 * Load a YAML config file from disk.
 * Returns undefined if file doesn't exist.
 * Throws with helpful message if file exists but is invalid.
 */
export function loadConfigFile(path: string): ConfigFile | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read config file ${path}: ${(err as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    throw new Error(`Invalid YAML in ${path}: ${(err as Error).message}`);
  }

  // Handle empty files
  if (parsed === null || parsed === undefined) {
    return {};
  }

  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Config validation failed for ${path}:\n${issues}`);
  }

  return result.data;
}

/**
 * Apply values from a config file to a resolved config object.
 * Only overrides values that are explicitly set in the source.
 */
function applyConfigFile(target: ResolvedConfig, source: ConfigFile): void {
  if (source.rateLimit?.concurrency !== undefined) {
    target.concurrency = source.rateLimit.concurrency;
  }
  if (source.rateLimit?.debounceMs !== undefined) {
    target.debounceMs = source.rateLimit.debounceMs;
  }
  if (source.rateLimit?.retryAttempts !== undefined) {
    target.retryAttempts = source.rateLimit.retryAttempts;
  }
  if (source.rateLimit?.retryDelayMs !== undefined) {
    target.retryDelayMs = source.rateLimit.retryDelayMs;
  }
  if (source.health?.socketPath !== undefined) {
    target.healthSocketPath = source.health.socketPath;
  }
  if (source.health?.enabled !== undefined) {
    target.healthEnabled = source.health.enabled;
  }
  if (source.watch?.patterns !== undefined) {
    target.patterns = source.watch.patterns;
  }
  if (source.logging?.level !== undefined) {
    target.logLevel = source.logging.level;
  }
  if (source.logging?.json !== undefined) {
    target.logJson = source.logging.json;
  }
  if (source.rateLimit?.usePolling !== undefined) {
    target.usePolling = source.rateLimit.usePolling;
  }
  if (source.rateLimit?.pollIntervalMs !== undefined) {
    target.pollIntervalMs = source.rateLimit.pollIntervalMs;
  }
}

/**
 * Filter out undefined values from an object.
 */
function filterUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

/**
 * Merge configuration sources with proper precedence:
 * CLI args > User config > System config > Defaults
 */
export function resolveConfig(
  cliOptions: Partial<ResolvedConfig> = {},
  userConfig: ConfigFile | undefined = undefined,
  systemConfig: ConfigFile | undefined = undefined
): ResolvedConfig {
  // Start with defaults
  const config: ResolvedConfig = {
    concurrency: CONFIG_DEFAULTS.concurrency,
    debounceMs: CONFIG_DEFAULTS.debounceMs,
    retryAttempts: CONFIG_DEFAULTS.retryAttempts,
    retryDelayMs: CONFIG_DEFAULTS.retryDelayMs,
    healthSocketPath: CONFIG_DEFAULTS.healthSocketPath,
    healthEnabled: true,
    patterns: [...CONFIG_DEFAULTS.patterns],
    logLevel: "info",
    logJson: false,
    usePolling: CONFIG_DEFAULTS.usePolling,
    pollIntervalMs: CONFIG_DEFAULTS.pollIntervalMs,
  };

  // Apply system config (lowest precedence after defaults)
  if (systemConfig) {
    applyConfigFile(config, systemConfig);
  }

  // Apply user config (higher precedence)
  if (userConfig) {
    applyConfigFile(config, userConfig);
  }

  // Apply CLI options (highest precedence)
  Object.assign(config, filterUndefined(cliOptions));

  return config;
}

/**
 * Load configuration from all sources.
 * Optionally accepts explicit config path from CLI.
 *
 * @param explicitPath - Optional path to a specific config file
 * @returns The resolved config and list of source files that were loaded
 */
export function loadConfig(explicitPath?: string): {
  config: ResolvedConfig;
  sources: string[];
} {
  const sources: string[] = [];

  let systemConfig: ConfigFile | undefined;
  let userConfig: ConfigFile | undefined;

  if (explicitPath) {
    // Explicit path takes precedence, used as "user config"
    userConfig = loadConfigFile(explicitPath);
    if (userConfig) sources.push(explicitPath);
  } else {
    // Normal precedence: system, then user
    systemConfig = loadConfigFile(SYSTEM_CONFIG_PATH);
    if (systemConfig) sources.push(SYSTEM_CONFIG_PATH);

    userConfig = loadConfigFile(USER_CONFIG_PATH);
    if (userConfig) sources.push(USER_CONFIG_PATH);
  }

  const config = resolveConfig({}, userConfig, systemConfig);

  return { config, sources };
}
