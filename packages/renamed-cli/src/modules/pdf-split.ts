import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { statSync, createWriteStream, mkdirSync } from "fs";
import { Writable } from "stream";
import { basename, join, resolve } from "path";
import type { ApiClient, MultipartField } from "../lib/api-client.js";

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

interface SplitDocument {
  filename: string;
  downloadUrl: string;
  pages: number[];
  metadata?: Record<string, unknown>;
}

type JobStatus = "pending" | "processing" | "completed" | "failed";

interface JobResponse {
  jobId: string;
  statusUrl: string;
  status: JobStatus;
}

interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  documents?: SplitDocument[];
  error?: string;
  progress?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateFilePath(filePath: string): void {
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

function validateOptions(options: PdfSplitOptions): void {
  const mode = options.mode ?? "smart";

  if (mode === "every-n-pages" && !options.pagesPerSplit) {
    throw new Error("--pages-per-split is required when using every-n-pages mode");
  }

  if (options.pagesPerSplit) {
    const pages = parseInt(options.pagesPerSplit, 10);
    if (isNaN(pages) || pages < 1) {
      throw new Error("--pages-per-split must be a positive integer");
    }
  }
}

function ensureOutputDir(outputDir: string): string {
  const resolved = resolve(outputDir);
  try {
    mkdirSync(resolved, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create output directory: ${(error as Error).message}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Job Polling
// ---------------------------------------------------------------------------

async function pollJobStatus(
  api: ApiClient,
  statusUrl: string,
  spinner: ReturnType<typeof ora>
): Promise<JobStatusResponse> {
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
        if (response.progress != null) {
          spinner.text = `Processing... ${response.progress}%`;
        }
        break;

      case "pending":
        spinner.text = "Waiting in queue...";
        break;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("Job timed out after 10 minutes");
}

// ---------------------------------------------------------------------------
// File Download
// ---------------------------------------------------------------------------

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const fileStream = createWriteStream(outputPath);

  // Use native ReadableStream from fetch with Node.js Writable stream
  await new Promise<void>((resolve, reject) => {
    const reader = response.body!.getReader();
    const writable = Writable.toWeb(fileStream);
    const writableStream = writable as WritableStream<Uint8Array>;

    new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          controller.enqueue(value);
        }
      }
    })
      .pipeTo(writableStream)
      .then(resolve)
      .catch(reject);
  });
}

async function downloadSplitDocuments(
  documents: SplitDocument[],
  outputDir: string,
  spinner: ReturnType<typeof ora>
): Promise<string[]> {
  const downloadedPaths: string[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    spinner.text = `Downloading ${i + 1}/${documents.length}: ${doc.filename}`;

    const outputPath = join(outputDir, doc.filename);
    await downloadFile(doc.downloadUrl, outputPath);
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
    fields.push({ name: "pagesPerSplit", value: parseInt(options.pagesPerSplit, 10) });
  }

  return api.uploadFileWithFields<JobResponse>("/pdf-split", filePath, fields);
}

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

function displayJobInfo(response: JobResponse): void {
  console.log(chalk.cyan("\nJob submitted:"));
  console.log(`  Job ID: ${response.jobId}`);
  console.log(`  Status: ${response.status}`);
  console.log(`  Status URL: ${response.statusUrl}`);
  console.log(chalk.gray("\nUse --wait to wait for completion and download files"));
}

function displayCompletionSummary(documents: SplitDocument[], downloadedPaths: string[]): void {
  console.log(chalk.cyan("\nSplit complete:"));
  console.log(`  Documents created: ${documents.length}`);
  console.log(chalk.bold("\nDownloaded files:"));

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const path = downloadedPaths[i];
    const pageInfo = doc.pages.length === 1 ? `page ${doc.pages[0]}` : `pages ${doc.pages.join(", ")}`;
    console.log(`  ${chalk.green("+")} ${path} (${pageInfo})`);
  }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerPdfSplitCommands(program: Command, api: ApiClient): void {
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
    .option(
      "-o, --output-dir <dir>",
      "Directory to save split files",
      "."
    )
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
          displayJobInfo(jobResponse);
          return;
        }

        // Wait mode: poll for completion and download files
        spinner.start("Waiting for job completion...");
        const statusResponse = await pollJobStatus(api, jobResponse.statusUrl, spinner);
        spinner.succeed("Processing complete");

        if (!statusResponse.documents || statusResponse.documents.length === 0) {
          console.log(chalk.yellow("No documents were created from the split"));
          return;
        }

        const outputDir = ensureOutputDir(options.outputDir ?? ".");
        spinner.start("Downloading split files...");
        const downloadedPaths = await downloadSplitDocuments(
          statusResponse.documents,
          outputDir,
          spinner
        );
        spinner.succeed("Downloads complete");

        displayCompletionSummary(statusResponse.documents, downloadedPaths);
      } catch (error) {
        spinner.fail("PDF split failed");
        console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
