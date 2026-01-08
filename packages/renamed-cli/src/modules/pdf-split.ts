import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { statSync, mkdirSync } from "fs";
import { basename, join, resolve } from "path";
import type { ApiClient, MultipartField } from "../lib/api-client.js";
import type { DownloadService } from "../lib/ports/download.js";
import type { DelayFn } from "../lib/ports/timer.js";
import { fetchDownloadService } from "../lib/adapters/fetch-download.js";
import { realDelay } from "../lib/adapters/real-timers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitMode = "smart" | "every-n-pages" | "by-bookmarks";

export interface PdfSplitOptions {
  mode?: SplitMode;
  instructions?: string;
  pagesPerSplit?: string;
  outputDir?: string;
  wait?: boolean;
}

export interface SplitDocument {
  filename: string;
  downloadUrl: string;
  pages: number[];
  metadata?: Record<string, unknown>;
}

type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobResponse {
  jobId: string;
  statusUrl: string;
  status: JobStatus;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  documents?: SplitDocument[];
  error?: string;
  progress?: number;
}

/**
 * Dependencies for PDF split operations.
 * All have sensible defaults for production use.
 */
export interface PdfSplitDeps {
  downloadService?: DownloadService;
  delay?: DelayFn;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max

// ---------------------------------------------------------------------------
// Validation (Pure Functions)
// ---------------------------------------------------------------------------

export function validateFilePath(filePath: string): void {
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
    throw new Error(`File exceeds 100MB limit (${sizeMB}MB): ${filePath}`);
  }
}

export function validateOptions(options: PdfSplitOptions): void {
  const mode = options.mode ?? "smart";

  if (mode === "every-n-pages" && !options.pagesPerSplit) {
    throw new Error(
      "--pages-per-split is required when using every-n-pages mode"
    );
  }

  if (options.pagesPerSplit) {
    const pages = parseInt(options.pagesPerSplit, 10);
    if (isNaN(pages) || pages < 1) {
      throw new Error("--pages-per-split must be a positive integer");
    }
  }
}

export function ensureOutputDir(outputDir: string): string {
  const resolved = resolve(outputDir);
  try {
    mkdirSync(resolved, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to create output directory: ${(error as Error).message}`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Job Polling
// ---------------------------------------------------------------------------

export async function pollJobStatus(
  api: ApiClient,
  statusUrl: string,
  deps: PdfSplitDeps = {},
  onProgress?: (status: JobStatusResponse) => void
): Promise<JobStatusResponse> {
  const { delay = realDelay } = deps;
  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;

    const response = await api.get<JobStatusResponse>(statusUrl);

    switch (response.status) {
      case "completed":
        return response;

      case "failed":
        throw new Error(response.error ?? "PDF split job failed");

      case "processing":
      case "pending":
        onProgress?.(response);
        break;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("Job timed out after 10 minutes");
}

// ---------------------------------------------------------------------------
// File Download
// ---------------------------------------------------------------------------

export async function downloadSplitDocuments(
  documents: SplitDocument[],
  outputDir: string,
  deps: PdfSplitDeps = {},
  onProgress?: (index: number, filename: string) => void
): Promise<string[]> {
  const { downloadService = fetchDownloadService } = deps;
  const downloadedPaths: string[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    onProgress?.(i, doc.filename);

    const outputPath = join(outputDir, doc.filename);
    await downloadService.download(doc.downloadUrl, outputPath);
    downloadedPaths.push(outputPath);
  }

  return downloadedPaths;
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

export async function splitPdf(
  api: ApiClient,
  filePath: string,
  options: PdfSplitOptions
): Promise<JobResponse> {
  validateFilePath(filePath);
  validateOptions(options);

  const mode = options.mode ?? "smart";
  const fields: MultipartField[] = [{ name: "mode", value: mode }];

  if (options.instructions) {
    fields.push({ name: "instructions", value: options.instructions });
  }

  if (options.pagesPerSplit) {
    fields.push({
      name: "pagesPerSplit",
      value: parseInt(options.pagesPerSplit, 10),
    });
  }

  return api.uploadFileWithFields<JobResponse>("/pdf-split", filePath, fields);
}

// ---------------------------------------------------------------------------
// Output Formatting (Pure Functions)
// ---------------------------------------------------------------------------

export function formatJobInfo(response: JobResponse): string[] {
  return [
    "",
    "Job submitted:",
    `  Job ID: ${response.jobId}`,
    `  Status: ${response.status}`,
    `  Status URL: ${response.statusUrl}`,
    "",
    "Use --wait to wait for completion and download files",
  ];
}

export function formatPageInfo(pages: number[]): string {
  return pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`;
}

export function formatCompletionSummary(
  documents: SplitDocument[],
  downloadedPaths: string[]
): string[] {
  const lines = [
    "",
    "Split complete:",
    `  Documents created: ${documents.length}`,
    "",
    "Downloaded files:",
  ];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const path = downloadedPaths[i];
    const pageInfo = formatPageInfo(doc.pages);
    lines.push(`  + ${path} (${pageInfo})`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerPdfSplitCommands(
  program: Command,
  api: ApiClient
): void {
  program
    .command("pdf-split")
    .description("Split PDF documents using AI or rule-based methods")
    .argument("<file>", "PDF file to split")
    .option(
      "-m, --mode <mode>",
      "Split mode: smart (AI), every-n-pages, or by-bookmarks",
      "smart"
    )
    .option(
      "-i, --instructions <text>",
      "AI instructions for smart mode (e.g., 'Split by invoice number')"
    )
    .option(
      "-n, --pages-per-split <number>",
      "Pages per split (required for every-n-pages mode)"
    )
    .option("-o, --output-dir <dir>", "Directory to save split files", ".")
    .option(
      "-w, --wait",
      "Wait for job completion and download files",
      false
    )
    .action(async (file: string, options: PdfSplitOptions) => {
      const spinner = ora(`Submitting ${basename(file)} for splitting`).start();

      try {
        const jobResponse = await splitPdf(api, file, options);
        spinner.succeed("Job submitted");

        if (!options.wait) {
          for (const line of formatJobInfo(jobResponse)) {
            console.log(line ? chalk.cyan(line) : "");
          }
          return;
        }

        // Wait mode: poll for completion and download files
        spinner.start("Waiting for job completion...");
        const statusResponse = await pollJobStatus(
          api,
          jobResponse.statusUrl,
          {},
          (status) => {
            if (status.status === "processing" && status.progress != null) {
              spinner.text = `Processing... ${status.progress}%`;
            } else if (status.status === "pending") {
              spinner.text = "Waiting in queue...";
            }
          }
        );
        spinner.succeed("Processing complete");

        if (
          !statusResponse.documents ||
          statusResponse.documents.length === 0
        ) {
          console.log(
            chalk.yellow("No documents were created from the split")
          );
          return;
        }

        const outputDir = ensureOutputDir(options.outputDir ?? ".");
        spinner.start("Downloading split files...");
        const downloadedPaths = await downloadSplitDocuments(
          statusResponse.documents,
          outputDir,
          {},
          (i, filename) => {
            spinner.text = `Downloading ${i + 1}/${statusResponse.documents!.length}: ${filename}`;
          }
        );
        spinner.succeed("Downloads complete");

        for (const line of formatCompletionSummary(
          statusResponse.documents,
          downloadedPaths
        )) {
          console.log(line ? chalk.cyan(line) : "");
        }
      } catch (error) {
        spinner.fail("PDF split failed");
        console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}
