import { Command } from "commander";
import chokidar, { type FSWatcher } from "chokidar";
import { resolve, extname } from "path";
import { statSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";
import type { ApiClient } from "../lib/api-client.js";
import {
  loadConfig,
  type ResolvedConfig,
} from "../lib/config.js";
import { createLogger, type Logger } from "../lib/logger.js";
import {
  createQueue,
  type ProcessingQueue,
  type QueueTask,
} from "../lib/queue.js";
import { processFile, type ProcessFileResult } from "../lib/file-processor.js";
import { createHealthServer, type HealthServer } from "../lib/health.js";
import type { FileWatcherFactory } from "../lib/ports/file-watcher.js";
import type { SignalHandler } from "../lib/ports/signal-handler.js";
import type { TimerService } from "../lib/ports/timer.js";
import { chokidarWatcherFactory } from "../lib/adapters/chokidar-watcher.js";
import { createProcessSignalHandler } from "../lib/adapters/process-signals.js";
import { realTimerService } from "../lib/adapters/real-timers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchOptions {
  patterns?: string[];
  outputDir?: string;
  failedDir?: string;
  dryRun?: boolean;
  concurrency?: string;
  config?: string;
}

export interface WatchContext {
  api: ApiClient;
  logger: Logger;
  config: ResolvedConfig;
  queue: ProcessingQueue<ProcessFileResult>;
  healthServer: HealthServer | null;
  watcher: FSWatcher | null;
  pendingFiles: Map<string, NodeJS.Timeout>;
  outputDir: string;
  failedDir: string;
  dryRun: boolean;
  isShuttingDown: boolean;
}

/**
 * Dependencies for watch operations.
 * All have sensible defaults for production use.
 */
export interface WatchDeps {
  watcherFactory?: FileWatcherFactory;
  signalHandler?: SignalHandler;
  timerService?: TimerService;
  fileExists?: (path: string) => boolean;
}

// ---------------------------------------------------------------------------
// Validation (Pure Functions)
// ---------------------------------------------------------------------------

/**
 * Validate and create a directory if needed.
 * Returns the resolved absolute path.
 */
export function validateDirectory(path: string, name: string): string {
  const resolved = resolve(path);

  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }

  const stats = statSync(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`${name} is not a directory: ${resolved}`);
  }

  return resolved;
}

/**
 * Check if a file matches any of the glob patterns.
 * Supports simple extension-based patterns like *.pdf
 */
export function matchesPatterns(filename: string, patterns: string[]): boolean {
  const ext = extname(filename).toLowerCase();

  for (const pattern of patterns) {
    // Simple glob matching for extensions
    if (pattern.startsWith("*.")) {
      const patternExt = pattern.slice(1).toLowerCase();
      if (ext === patternExt) return true;
    } else if (pattern === filename) {
      return true;
    }
  }

  return false;
}

/**
 * Parse and validate concurrency option.
 * Returns number between 1-10 or throws error.
 */
export function parseConcurrency(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 10) {
    throw new Error("Concurrency must be between 1 and 10");
  }
  return n;
}

// ---------------------------------------------------------------------------
// Core Watch Logic
// ---------------------------------------------------------------------------

/**
 * Handler context for file events.
 */
export interface FileHandlerContext {
  config: { patterns: string[]; debounceMs: number };
  logger: Logger;
  pendingFiles: Map<string, NodeJS.Timeout>;
  onFileReady: (filePath: string) => void;
}

/**
 * Create a handler function for new file events.
 * Implements debouncing to handle batch file drops.
 */
export function createFileHandler(
  ctx: FileHandlerContext,
  deps: WatchDeps = {}
): (filePath: string) => void {
  const { timerService = realTimerService, fileExists = existsSync } = deps;

  return (filePath: string) => {
    // Check file pattern
    if (!matchesPatterns(filePath, ctx.config.patterns)) {
      ctx.logger.debug("File does not match patterns, ignoring", { filePath });
      return;
    }

    // Debounce: clear existing timeout for this file
    const existing = ctx.pendingFiles.get(filePath);
    if (existing) {
      timerService.clearTimeout(existing);
    }

    // Schedule processing after debounce period
    const timeout = timerService.setTimeout(() => {
      ctx.pendingFiles.delete(filePath);

      // Verify file still exists (might have been moved/deleted)
      if (!fileExists(filePath)) {
        ctx.logger.debug("File no longer exists, skipping", { filePath });
        return;
      }

      ctx.onFileReady(filePath);
    }, ctx.config.debounceMs);

    ctx.pendingFiles.set(filePath, timeout);
  };
}

/**
 * Create the file processing callback for use with createFileHandler.
 */
function createFileProcessor(ctx: WatchContext): (filePath: string) => void {
  return (filePath: string) => {
    const task: QueueTask<ProcessFileResult> = {
      id: filePath,
      execute: async () => {
        const result = await processFile(
          ctx.api,
          filePath,
          {
            apply: true,
            outputDir: ctx.outputDir,
            failedDir: ctx.failedDir,
            dryRun: ctx.dryRun,
          },
          ctx.logger
        );

        if (result.success) {
          ctx.healthServer?.recordSuccess();
        } else {
          ctx.healthServer?.recordError();
        }

        ctx.healthServer?.updateStats(ctx.queue.getStats());

        return result;
      },
    };

    ctx.queue.enqueue(task);
  };
}

function createWatchHandler(ctx: WatchContext): (filePath: string) => void {
  const handlerCtx: FileHandlerContext = {
    config: ctx.config,
    logger: ctx.logger,
    pendingFiles: ctx.pendingFiles,
    onFileReady: createFileProcessor(ctx),
  };
  return createFileHandler(handlerCtx);
}

/**
 * Start watching a directory for new files.
 */
async function startWatching(
  ctx: WatchContext,
  watchDir: string
): Promise<void> {
  const resolvedWatchDir = validateDirectory(watchDir, "Watch directory");

  ctx.logger.info("Starting file watcher", {
    watchDir: resolvedWatchDir,
    outputDir: ctx.outputDir,
    failedDir: ctx.failedDir,
    patterns: ctx.config.patterns,
    concurrency: ctx.config.concurrency,
    dryRun: ctx.dryRun,
  });

  const handler = createWatchHandler(ctx);

  ctx.watcher = chokidar.watch(resolvedWatchDir, {
    persistent: true,
    ignoreInitial: true, // Don't process existing files on startup
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
    ignored: [
      /(^|[/\\])\../, // Ignore dotfiles
      "**/node_modules/**",
    ],
  });

  ctx.watcher.on("add", handler);
  ctx.watcher.on("change", handler);

  ctx.watcher.on("error", (error: unknown) => {
    ctx.logger.error("Watcher error", { error: (error as Error).message });
  });

  ctx.watcher.on("ready", () => {
    ctx.logger.info("Watcher ready, monitoring for new files");
  });
}

/**
 * Clear all pending debounced files.
 */
export function clearPendingFiles(
  pendingFiles: Map<string, NodeJS.Timeout>,
  deps: WatchDeps = {}
): void {
  const { timerService = realTimerService } = deps;
  for (const timeout of pendingFiles.values()) {
    timerService.clearTimeout(timeout);
  }
  pendingFiles.clear();
}

/**
 * Gracefully shutdown the watch process.
 * Drains the queue and stops the health server.
 */
export async function shutdown(
  ctx: WatchContext,
  deps: WatchDeps = {}
): Promise<void> {
  if (ctx.isShuttingDown) return;
  ctx.isShuttingDown = true;

  ctx.logger.info("Shutting down gracefully...");

  // Stop accepting new files
  if (ctx.watcher) {
    await ctx.watcher.close();
  }

  // Clear pending debounced files
  clearPendingFiles(ctx.pendingFiles, deps);

  // Wait for active tasks to complete
  const stats = ctx.queue.getStats();
  if (stats.active > 0 || stats.pending > 0) {
    ctx.logger.info("Waiting for active tasks to complete...", {
      active: stats.active,
      pending: stats.pending,
    });
    await ctx.queue.drain();
  }

  // Stop health server
  if (ctx.healthServer) {
    await ctx.healthServer.stop();
  }

  const finalStats = ctx.queue.getStats();
  ctx.logger.info("Shutdown complete", {
    completed: finalStats.completed,
    failed: finalStats.failed,
    averageLatencyMs: finalStats.averageLatencyMs,
  });
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerWatchCommands(program: Command, api: ApiClient): void {
  program
    .command("watch")
    .description("Watch directories and auto-organize files using AI")
    .argument("<directory>", "Directory to watch for new files")
    .option(
      "-p, --patterns <patterns...>",
      "File patterns to process (e.g., *.pdf *.jpg)"
    )
    .option("-o, --output-dir <dir>", "Base output directory for organized files")
    .option(
      "-f, --failed-dir <dir>",
      "Directory for files that fail processing"
    )
    .option("-n, --dry-run", "Preview actions without moving files", false)
    .option("--concurrency <n>", "Number of files to process in parallel")
    .option("-c, --config <path>", "Path to configuration file")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("How It Works:")}
  1. Watches directory for new/changed files matching patterns
  2. Sends each file to AI for renaming suggestions
  3. Moves files to output directory with AI-suggested names
  4. Failed files go to --failed-dir (default: .failed/)

${chalk.bold.cyan("File Patterns:")}
  Default: ${chalk.yellow("*.pdf *.jpg *.jpeg *.png *.tiff")}
  Override with ${chalk.yellow("-p")} to process specific types only

${chalk.bold.cyan("Configuration File:")}
  YAML file with persistent settings:
  ${chalk.gray("patterns: ['*.pdf', '*.jpg']")}
  ${chalk.gray("concurrency: 3")}
  ${chalk.gray("debounceMs: 1000")}
  ${chalk.gray("logLevel: info")}

${chalk.bold.cyan("Examples:")}
  renamed watch ~/Downloads -o ~/Documents
      ${chalk.gray("Watch Downloads, organize into Documents")}

  renamed watch ~/incoming -p "*.pdf" "*.jpg"
      ${chalk.gray("Only process PDFs and JPGs")}

  renamed watch ~/inbox --dry-run
      ${chalk.gray("Preview what would happen without moving files")}

  renamed watch ~/inbox --concurrency 5
      ${chalk.gray("Process up to 5 files in parallel")}

  renamed watch ~/inbox -c ~/.renamed/watch.yaml
      ${chalk.gray("Use configuration file for settings")}

  renamed watch ~/scans -o ~/Documents -f ~/failed
      ${chalk.gray("Custom output and failed directories")}

${chalk.bold.cyan("Tips:")}
  • Use ${chalk.yellow("--dry-run")} first to preview behavior
  • Press ${chalk.yellow("Ctrl+C")} to stop gracefully (waits for active jobs)
  • Check ${chalk.yellow(".failed/")} directory for problematic files
`
    )
    .action(async (directory: string, options: WatchOptions) => {
      // Load configuration
      const { config, sources } = loadConfig(options.config);

      // Apply CLI overrides
      if (options.patterns) {
        config.patterns = options.patterns;
      }
      if (options.concurrency) {
        try {
          config.concurrency = parseConcurrency(options.concurrency);
        } catch (error) {
          console.error(chalk.red((error as Error).message));
          process.exitCode = 1;
          return;
        }
      }

      // Create logger
      const logger = createLogger({
        level: config.logLevel,
        json: config.logJson,
      });

      if (sources.length > 0) {
        logger.info("Loaded configuration", { sources });
      }

      // Validate required directories
      const outputDir = options.outputDir ?? directory;
      const failedDir = options.failedDir ?? resolve(directory, ".failed");

      let resolvedOutputDir: string;
      let resolvedFailedDir: string;

      try {
        resolvedOutputDir = validateDirectory(outputDir, "Output directory");
        resolvedFailedDir = validateDirectory(failedDir, "Failed directory");
      } catch (error) {
        logger.error("Directory validation failed", {
          error: (error as Error).message,
        });
        process.exitCode = 1;
        return;
      }

      // Create processing queue
      const queue = createQueue<ProcessFileResult>({
        concurrency: config.concurrency,
        retryAttempts: config.retryAttempts,
        retryDelayMs: config.retryDelayMs,
        logger,
      });

      // Create health server
      let healthServer: HealthServer | null = null;
      if (config.healthEnabled) {
        healthServer = createHealthServer(config.healthSocketPath, logger);
        try {
          await healthServer.start();
        } catch (error) {
          logger.warn(
            "Failed to start health server, continuing without it",
            {
              error: (error as Error).message,
            }
          );
          healthServer = null;
        }
      }

      // Create context
      const ctx: WatchContext = {
        api,
        logger,
        config,
        queue,
        healthServer,
        watcher: null,
        pendingFiles: new Map(),
        outputDir: resolvedOutputDir,
        failedDir: resolvedFailedDir,
        dryRun: options.dryRun ?? false,
        isShuttingDown: false,
      };

      // Setup signal handlers for graceful shutdown
      const handleSignal = (signal: string) => {
        logger.info("Received signal", { signal });
        void shutdown(ctx).then(() => process.exit(0));
      };

      process.on("SIGTERM", () => handleSignal("SIGTERM"));
      process.on("SIGINT", () => handleSignal("SIGINT"));

      // Start watching
      try {
        await startWatching(ctx, directory);
        logger.info("Watch mode started. Press Ctrl+C to stop.");
      } catch (error) {
        logger.error("Failed to start watcher", {
          error: (error as Error).message,
        });
        await shutdown(ctx);
        process.exitCode = 1;
      }
    });
}
