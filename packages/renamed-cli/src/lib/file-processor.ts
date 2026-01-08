import { statSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
import { rename as renameFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import type { ApiClient } from "./api-client.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from the rename API including AI-suggested folder path */
export interface RenameResult {
  originalFilename: string;
  suggestedFilename: string;
  suggestedFolderPath?: string;
}

/** Options for processing a single file */
export interface ProcessFileOptions {
  /** Move file to destination (vs just return suggestion) */
  apply: boolean;
  /** Base output directory for organized files */
  outputDir?: string;
  /** Directory for files that fail processing */
  failedDir?: string;
  /** Dry run - log what would happen without moving */
  dryRun?: boolean;
}

/** Result of processing a single file */
export interface ProcessFileResult {
  success: boolean;
  originalPath: string;
  suggestedFilename: string;
  suggestedFolderPath?: string;
  destinationPath?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (25 MB) */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a file exists, is readable, and within size limits.
 * Throws descriptive error if validation fails.
 */
export function validateFile(filePath: string): void {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw new Error(`Cannot access file: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  if (stats.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    throw new Error(`File exceeds 25MB limit (${sizeMB}MB): ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// File Movement
// ---------------------------------------------------------------------------

/**
 * Move a file to a new location, creating directories as needed.
 * Uses copy+delete for cross-device compatibility.
 */
async function moveFile(
  sourcePath: string,
  destPath: string,
  logger?: Logger
): Promise<void> {
  const targetDir = dirname(destPath);
  mkdirSync(targetDir, { recursive: true });

  try {
    // Try atomic rename first (fast, same filesystem)
    await renameFile(sourcePath, destPath);
  } catch (error) {
    // Fall back to copy+delete for cross-device moves
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      logger?.debug("Cross-device move, using copy+delete", {
        from: sourcePath,
        to: destPath,
      });
      copyFileSync(sourcePath, destPath);
      unlinkSync(sourcePath);
    } else {
      throw error;
    }
  }
}

/**
 * Move a failed file to the failed directory.
 * Creates a timestamped filename to avoid collisions.
 */
async function moveToFailed(
  filePath: string,
  failedDir: string,
  logger?: Logger
): Promise<void> {
  try {
    const filename = basename(filePath);
    const timestamp = Date.now();
    const targetPath = join(failedDir, `${timestamp}-${filename}`);

    mkdirSync(failedDir, { recursive: true });

    // Use copy+delete for cross-device compatibility
    copyFileSync(filePath, targetPath);
    unlinkSync(filePath);

    logger?.warn("File moved to failed directory", {
      from: filePath,
      to: targetPath,
    });
  } catch (err) {
    logger?.error("Failed to move file to failed directory", {
      filePath,
      error: (err as Error).message,
    });
  }
}

// ---------------------------------------------------------------------------
// Core Processing
// ---------------------------------------------------------------------------

/**
 * Process a single file through the rename API.
 * Optionally moves file to destination based on AI suggestions.
 *
 * @param api - API client instance
 * @param filePath - Path to the file to process
 * @param options - Processing options
 * @param logger - Optional logger instance
 * @returns Processing result with success status and destination info
 */
export async function processFile(
  api: ApiClient,
  filePath: string,
  options: ProcessFileOptions,
  logger?: Logger
): Promise<ProcessFileResult> {
  const log = logger ?? {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  try {
    // Validate input file
    validateFile(filePath);

    log.debug("Uploading file for rename", { filePath });

    // Call rename API
    const result = await api.uploadFile<RenameResult>("/rename", filePath);

    log.debug("Received rename suggestion", {
      original: result.originalFilename,
      suggested: result.suggestedFilename,
      folder: result.suggestedFolderPath,
    });

    // Build destination path
    let destinationPath: string | undefined;
    if (options.apply && options.outputDir) {
      const folderPath = result.suggestedFolderPath ?? "";
      const targetDir = resolve(options.outputDir, folderPath);
      destinationPath = join(targetDir, result.suggestedFilename);
    } else if (options.apply) {
      // No output dir - rename in place
      destinationPath = join(dirname(filePath), result.suggestedFilename);
    }

    // Execute move if not dry run
    if (options.apply && destinationPath && !options.dryRun) {
      await moveFile(filePath, destinationPath, logger);
      log.info("File moved", { from: filePath, to: destinationPath });
    } else if (options.dryRun && destinationPath) {
      log.info("Dry run - would move", { from: filePath, to: destinationPath });
    }

    return {
      success: true,
      originalPath: filePath,
      suggestedFilename: result.suggestedFilename,
      suggestedFolderPath: result.suggestedFolderPath,
      destinationPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("File processing failed", { filePath, error: errorMessage });

    // Move to failed dir if specified and not a dry run
    if (options.failedDir && !options.dryRun) {
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
