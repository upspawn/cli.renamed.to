import { Command } from "commander";
import chokidar, { type FSWatcher } from "chokidar";
import { resolve, extname, basename, join } from "path";
import { statSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
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
import { processFile, moveToFailed, type ProcessFileResult } from "../lib/file-processor.js";
import {
  splitPdf,
  pollJobStatus,
  downloadSplitDocuments,
  validateFilePath as validatePdfFilePath,
  type PdfSplitDeps,
} from "./pdf-split.js";
import { createHealthServer, type HealthServer } from "../lib/health.js";
import type { FileWatcherFactory } from "../lib/ports/file-watcher.js";
import type { SignalHandler } from "../lib/ports/signal-handler.js";
import type { TimerService } from "../lib/ports/timer.js";
import { realTimerService } from "../lib/adapters/real-timers.js";
import { isJsonMode } from "../lib/cli-context.js";
import { outputNdjson, type WatchEventJson } from "../lib/json-output.js";
import { getFileIdentity } from "../lib/file-identity.js";

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
  poll?: boolean;
  pollInterval?: string;
  passthrough?: boolean;
  passthroughDir?: string;
  splitPdfs?: boolean;
  deleteSourcePdf?: boolean;
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
  jsonMode: boolean;
  passthrough: boolean;
  passthroughDir: string;
  splitPdfs: boolean;
  deleteSourcePdf: boolean;
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

/**
 * Check if a file is a PDF based on extension.
 */
export function isPdfFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ".pdf";
}

// ---------------------------------------------------------------------------
// Passthrough (Pipeline Mode)
// ---------------------------------------------------------------------------

/**
 * Move a failed file to the passthrough directory with its original filename.
 * Unlike moveToFailed, this preserves the original name (no timestamp prefix)
 * so the file can continue through a pipeline untouched.
 *
 * @returns The destination path, or undefined if the move failed.
 */
export async function moveToPassthrough(
  filePath: string,
  passthroughDir: string,
  logger?: Logger,
  dryRun?: boolean
): Promise<string | undefined> {
  const filename = basename(filePath);
  const targetPath = join(passthroughDir, filename);

  if (dryRun) {
    logger?.info("Dry run - would passthrough", { from: filePath, to: targetPath });
    return targetPath;
  }

  try {
    mkdirSync(passthroughDir, { recursive: true });
    copyFileSync(filePath, targetPath);
    unlinkSync(filePath);
    logger?.warn("File passed through untouched (processing failed)", {
      from: filePath,
      to: targetPath,
    });
    return targetPath;
  } catch (err) {
    logger?.error("Failed to move file to passthrough directory", {
      filePath,
      error: (err as Error).message,
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// PDF Split Processing
// ---------------------------------------------------------------------------

/** Options for processing a PDF through the split API */
export interface ProcessPdfSplitOptions {
  outputDir: string;
  failedDir?: string;
  dryRun?: boolean;
  deleteSourcePdf?: boolean;
}

/**
 * Process a PDF file through the split API.
 * Uploads the PDF, polls for completion, downloads split documents,
 * and optionally deletes the original.
 */
export async function processPdfSplit(
  api: ApiClient,
  filePath: string,
  options: ProcessPdfSplitOptions,
  logger?: Logger,
  deps: PdfSplitDeps = {}
): Promise<ProcessFileResult> {
  const log = logger ?? {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  try {
    // Validate input file (uses 100MB limit from pdf-split)
    validatePdfFilePath(filePath);

    // Dry-run: skip API calls entirely — don't burn quota
    if (options.dryRun) {
      log.info("Dry run - would submit PDF for splitting", {
        filePath,
        deleteSourcePdf: options.deleteSourcePdf ?? false,
      });
      return {
        success: true,
        originalPath: filePath,
        suggestedFilename: basename(filePath),
        destinationPath: options.outputDir,
        splitOutputPaths: [],
        splitDocumentCount: 0,
      };
    }

    log.info("Submitting PDF for splitting", { filePath });
    log.warn("PDF split job may hold a queue slot for several minutes while polling", { filePath });

    // 1. Upload to /pdf-split API with smart mode
    const jobResponse = await splitPdf(api, filePath, { mode: "smart" });
    log.debug("Split job submitted", {
      jobId: jobResponse.jobId,
      statusUrl: jobResponse.statusUrl,
    });

    // 2. Poll until completed/failed
    const statusResponse = await pollJobStatus(
      api,
      jobResponse.statusUrl,
      deps,
      (status) => {
        log.debug("Split job progress", {
          jobId: status.jobId,
          status: status.status,
          progress: status.progress,
        });
      }
    );

    if (!statusResponse.documents || statusResponse.documents.length === 0) {
      log.warn("Split produced no documents", { filePath });
      return {
        success: true,
        originalPath: filePath,
        suggestedFilename: basename(filePath),
        destinationPath: options.outputDir,
        splitOutputPaths: [],
        splitDocumentCount: 0,
      };
    }

    // 3. Download split documents with partial cleanup on failure
    mkdirSync(options.outputDir, { recursive: true });
    let downloadedPaths: string[];
    try {
      downloadedPaths = await downloadSplitDocuments(
        statusResponse.documents,
        options.outputDir,
        deps,
        (i, filename) => {
          log.debug("Downloading split document", {
            index: i,
            filename,
            total: statusResponse.documents!.length,
          });
        }
      );
    } catch (downloadError) {
      // Clean up any partially downloaded files
      for (const doc of statusResponse.documents) {
        const partialPath = join(options.outputDir, doc.filename);
        try {
          unlinkSync(partialPath);
        } catch {
          // File may not exist if download hadn't reached it yet
        }
      }
      throw downloadError;
    }

    // 4. Optionally delete the original PDF
    if (options.deleteSourcePdf) {
      unlinkSync(filePath);
      log.info("Deleted source PDF after split", { filePath });
    }

    return {
      success: true,
      originalPath: filePath,
      suggestedFilename: statusResponse.documents[0].filename,
      destinationPath: options.outputDir,
      splitOutputPaths: downloadedPaths,
      splitDocumentCount: statusResponse.documents.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("PDF split failed", { filePath, error: errorMessage });

    // Move to failed dir if specified
    if (options.failedDir) {
      await moveToFailed(filePath, options.failedDir, logger);
    }

    return {
      success: false,
      originalPath: filePath,
      suggestedFilename: basename(filePath),
      error: errorMessage,
    };
  }
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
        // Always capture file identity upfront — file may be deleted by split
        const fileIdentity = getFileIdentity(filePath);

        const failedDir = ctx.passthrough ? undefined : ctx.failedDir;
        const useSplit = ctx.splitPdfs && isPdfFile(filePath);
        let result: ProcessFileResult;

        if (useSplit) {
          result = await processPdfSplit(
            ctx.api,
            filePath,
            {
              outputDir: ctx.outputDir,
              failedDir,
              dryRun: ctx.dryRun,
              deleteSourcePdf: ctx.deleteSourcePdf,
            },
            ctx.logger
          );
        } else {
          result = await processFile(
            ctx.api,
            filePath,
            {
              apply: true,
              outputDir: ctx.outputDir,
              failedDir,
              dryRun: ctx.dryRun,
            },
            ctx.logger
          );
        }

        if (result.success) {
          ctx.healthServer?.recordSuccess();
        } else {
          ctx.healthServer?.recordError();
        }

        // Passthrough: move failed files to passthrough dir with original name
        let passthroughPath: string | undefined;
        if (!result.success && ctx.passthrough) {
          passthroughPath = await moveToPassthrough(
            filePath,
            ctx.passthroughDir,
            ctx.logger,
            ctx.dryRun
          );
        }

        ctx.healthServer?.updateStats(ctx.queue.getStats());

        // Emit NDJSON event if in JSON mode
        if (ctx.jsonMode) {
          if (useSplit && result.success) {
            const event: WatchEventJson = {
              type: "split",
              timestamp: new Date().toISOString(),
              data: {
                file: fileIdentity,
                splitResult: {
                  outputPaths: result.splitOutputPaths ?? [],
                  documentCount: result.splitDocumentCount ?? 0,
                  sourceDeleted: ctx.deleteSourcePdf && !ctx.dryRun,
                },
              },
            };
            outputNdjson(event);
          } else {
            const eventType = result.success
              ? "file"
              : passthroughPath
                ? "passthrough"
                : "error";

            const event: WatchEventJson = {
              type: eventType,
              timestamp: new Date().toISOString(),
              data: {
                file: fileIdentity,
                result: result.success ? {
                  suggestedName: result.suggestedFilename,
                  suggestedFolder: result.suggestedFolderPath,
                  applied: !ctx.dryRun,
                  outputPath: result.destinationPath,
                } : undefined,
                error: result.error,
                passthroughPath,
              },
            };
            outputNdjson(event);
          }
        }

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
    failedDir: ctx.passthrough ? "(disabled - using passthrough)" : ctx.failedDir,
    passthrough: ctx.passthrough,
    ...(ctx.passthrough && { passthroughDir: ctx.passthroughDir }),
    splitPdfs: ctx.splitPdfs,
    ...(ctx.splitPdfs && { deleteSourcePdf: ctx.deleteSourcePdf }),
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
    usePolling: ctx.config.usePolling || undefined,
    interval: ctx.config.usePolling ? ctx.config.pollIntervalMs : undefined,
  });

  ctx.watcher.on("add", handler);
  ctx.watcher.on("change", handler);

  ctx.watcher.on("error", (error: unknown) => {
    ctx.logger.error("Watcher error", { error: (error as Error).message });
  });

  ctx.watcher.on("ready", () => {
    ctx.logger.info("Watcher ready, monitoring for new files");

    // Emit NDJSON start event
    if (ctx.jsonMode) {
      const event: WatchEventJson = {
        type: "start",
        timestamp: new Date().toISOString(),
        data: {
          file: { path: resolvedWatchDir, size: 0, mtime: new Date().toISOString() },
        },
      };
      outputNdjson(event);
    }
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

  // Emit NDJSON stop event
  if (ctx.jsonMode) {
    const event: WatchEventJson = {
      type: "stop",
      timestamp: new Date().toISOString(),
    };
    outputNdjson(event);
  }
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
    .option("--poll", "Use polling instead of native filesystem events (for Docker/NFS)")
    .option("--poll-interval <ms>", "Polling interval in milliseconds (default: 500)")
    .option("--passthrough", "Move unprocessable files to output dir untouched (pipeline mode)")
    .option("--passthrough-dir <dir>", "Custom directory for passthrough files (default: output dir)")
    .option("--split-pdfs", "Split PDF files into separate documents using AI", false)
    .option("--delete-source-pdf", "Delete source PDF after successful split (requires --split-pdfs)", false)
    .option("-c, --config <path>", "Path to configuration file")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("How It Works:")}
  1. Watches directory for new/changed files matching patterns
  2. Sends each file to AI for renaming suggestions
  3. With ${chalk.yellow("--split-pdfs")}: PDFs are split into separate documents instead
  4. Output files go to --output-dir with AI-suggested names
  5. Failed files go to --failed-dir (default: .failed/)

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

  renamed watch ~/inbox --json
      ${chalk.gray("Stream NDJSON events for scripting")}

  renamed watch /data --poll
      ${chalk.gray("Use polling for Docker/NFS mounted volumes")}

  renamed watch /data --poll --poll-interval 1000
      ${chalk.gray("Poll every 1000ms (default: 500ms)")}

${chalk.bold.cyan("PDF Splitting (--split-pdfs):")}
  Use ${chalk.yellow("--split-pdfs")} to split PDFs into separate documents using AI.
  Without this flag, PDFs are renamed like any other file.
  ${chalk.gray("renamed watch ~/scans -o ~/Documents --split-pdfs")}
  ${chalk.gray("  PDFs → split into separate documents")}
  ${chalk.gray("  Other files → renamed by AI")}
  Use ${chalk.yellow("--delete-source-pdf")} to remove the source PDF after split.

${chalk.bold.cyan("Pipeline Mode (Passthrough):")}
  Use ${chalk.yellow("--passthrough")} to ensure files always move forward.
  Failed files go to output directory with original names.
  ${chalk.gray("renamed watch ~/inbox -o ~/output --passthrough")}
  ${chalk.gray("renamed watch ~/inbox -o ~/output --passthrough --passthrough-dir ~/unprocessed")}

${chalk.bold.cyan("Tips:")}
  • Use ${chalk.yellow("--dry-run")} first to preview behavior
  • Press ${chalk.yellow("Ctrl+C")} to stop gracefully (waits for active jobs)
  • Use ${chalk.yellow("--poll")} in Docker or with network-mounted volumes
  • Use ${chalk.yellow("--passthrough")} in pipelines to never block on failures
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

      // Apply polling overrides
      if (options.poll) {
        config.usePolling = true;
      }
      if (options.pollInterval) {
        const interval = parseInt(options.pollInterval, 10);
        if (isNaN(interval) || interval < 100 || interval > 10000) {
          console.error(chalk.red("Poll interval must be between 100 and 10000 ms"));
          process.exitCode = 1;
          return;
        }
        config.pollIntervalMs = interval;
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

      // Resolve passthrough options
      const passthrough = options.passthrough ?? false;
      let resolvedPassthroughDir = resolvedOutputDir;

      if (passthrough) {
        const passthroughDir = options.passthroughDir ?? outputDir;
        try {
          resolvedPassthroughDir = validateDirectory(
            passthroughDir,
            "Passthrough directory"
          );
        } catch (error) {
          logger.error("Directory validation failed", {
            error: (error as Error).message,
          });
          process.exitCode = 1;
          return;
        }

        if (!options.outputDir && !options.passthroughDir) {
          logger.warn(
            "Passthrough enabled but no --output-dir or --passthrough-dir specified. " +
            "Failed files will stay in the watch directory with their original names."
          );
        }
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
      const jsonMode = isJsonMode();
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
        jsonMode,
        passthrough,
        passthroughDir: resolvedPassthroughDir,
        splitPdfs: options.splitPdfs ?? false,
        deleteSourcePdf: options.deleteSourcePdf ?? false,
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
