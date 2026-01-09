import { Command } from "commander";
import chalk from "chalk";
import { statSync, mkdirSync, existsSync } from "fs";
import { rename as renameFile } from "fs/promises";
import { basename, dirname, join, resolve, extname } from "path";
import type { ApiClient } from "../lib/api-client.js";
import { isCLIError, renderError, CLIError } from "../lib/errors/index.js";
import { createSpinner } from "../lib/spinner.js";
import { isJsonMode, getConflictStrategy } from "../lib/cli-context.js";
import { outputSuccess, type RenameResultJson, type FileIdentity } from "../lib/json-output.js";
import { getFileIdentity, generateConflictSuffix } from "../lib/file-identity.js";

type Strategy =
  | "by_date"
  | "by_issuer"
  | "by_type"
  | "by_date_issuer"
  | "by_date_type"
  | "by_issuer_type"
  | "by_all"
  | "root"
  | "follow_custom_prompt";

type PredefinedTemplate =
  | "standard"
  | "date_first"
  | "company_first"
  | "minimal"
  | "detailed"
  | "department_focus";

interface RenameOptions {
  apply?: boolean;
  outputDir?: string;
  prompt?: string;
  strategy?: Strategy;
  template?: PredefinedTemplate;
  language?: string;
  overwrite?: boolean;
}

interface RenameResult {
  originalFilename: string;
  suggestedFilename: string;
  folderPath?: string;
  // Legacy field name (keeping for backwards compatibility)
  suggestedFolderPath?: string;
}

interface FileRenameResult {
  input: FileIdentity;
  output?: {
    path: string;
    folder?: string;
  };
  status: "renamed" | "skipped" | "error" | "preview";
  suggestedName: string;
  suggestedFolder?: string;
  applied: boolean;
  error?: string;
}

export function registerRenameCommands(program: Command, api: ApiClient): void {
  const rename = program.command("rename").description("Rename files using AI");

  rename
    .argument("<files...>", "File paths to rename (PDF, JPG, PNG, TIFF, max 25MB)")
    .option("-a, --apply", "Apply the suggested filename (otherwise just preview)")
    .option("-o, --output-dir <dir>", "Output directory (uses AI folder structure if available)")
    .option("-p, --prompt <instruction>", "Custom AI instruction for filename format")
    .option("-s, --strategy <name>", "Folder organization strategy (see below)")
    .option("-t, --template <name>", "Predefined filename template (see below)")
    .option("-l, --language <code>", "Output language code (en, de, fr, es, ...)")
    .option("--overwrite", "Overwrite existing files (default: respect --on-conflict)")
    .addHelpText(
      "after",
      `
${chalk.bold.cyan("Strategies (--strategy, -s):")}
  ${chalk.yellow("by_date")}          Organize by year/month (2024/January/)
  ${chalk.yellow("by_issuer")}        Organize by company/sender
  ${chalk.yellow("by_type")}          Organize by document type (Invoices/, Contracts/)
  ${chalk.yellow("by_date_issuer")}   Combine date and issuer
  ${chalk.yellow("by_date_type")}     Combine date and type
  ${chalk.yellow("by_issuer_type")}   Combine issuer and type
  ${chalk.yellow("by_all")}           Full hierarchy (date/issuer/type)
  ${chalk.yellow("root")}             No folders, flat structure
  ${chalk.yellow("follow_custom_prompt")}  Use folders from --prompt instruction

${chalk.bold.cyan("Templates (--template, -t):")}
  ${chalk.yellow("standard")}         Balanced format with key info
  ${chalk.yellow("date_first")}       Date at start: 2024-01-15_Invoice_Acme.pdf
  ${chalk.yellow("company_first")}    Company at start: Acme_Invoice_2024-01-15.pdf
  ${chalk.yellow("minimal")}          Short names, essential info only
  ${chalk.yellow("detailed")}         Comprehensive with all metadata
  ${chalk.yellow("department_focus")} Organized by department/category

${chalk.bold.cyan("Conflict Resolution:")}
  ${chalk.yellow("--overwrite")}      Overwrite existing files
  ${chalk.yellow("--on-conflict")}    fail (default), skip, or suffix

${chalk.bold.cyan("Examples:")}
  renamed rename invoice.pdf
      ${chalk.gray("Preview AI-suggested filename")}

  renamed rename -a invoice.pdf
      ${chalk.gray("Rename file with AI suggestion")}

  renamed rename -a *.pdf --json
      ${chalk.gray("Batch rename with JSON output")}

  renamed rename -p "Format: YYYY-MM-DD_CompanyName_Type" invoice.pdf
      ${chalk.gray("Use custom naming instruction")}

  renamed rename -s by_date -o ~/Documents -a invoice.pdf
      ${chalk.gray("Organize into date-based folders")}

  renamed rename -a invoice.pdf --on-conflict suffix
      ${chalk.gray("Add suffix if file exists")}
`
    )
    .action((files: string[], options: RenameOptions) => renameFiles(api, files, options));
}

/**
 * Resolve output path, handling conflicts according to strategy.
 */
function resolveOutputPath(
  targetPath: string,
  overwrite: boolean
): { path: string; skipped: boolean } {
  if (!existsSync(targetPath) || overwrite) {
    return { path: targetPath, skipped: false };
  }

  const strategy = getConflictStrategy();

  switch (strategy) {
    case "skip":
      return { path: targetPath, skipped: true };

    case "suffix": {
      const dir = dirname(targetPath);
      const ext = extname(targetPath);
      const base = basename(targetPath, ext);
      const suffix = generateConflictSuffix();
      const newPath = join(dir, `${base}_${suffix}${ext}`);
      return { path: newPath, skipped: false };
    }

    case "fail":
    default:
      throw new CLIError("FILE_NOT_FOUND", `File already exists: ${targetPath}`, {
        suggestion: "Use --overwrite to replace, or --on-conflict suffix to add a suffix",
      });
  }
}

export async function renameFiles(api: ApiClient, filePaths: string[], options: RenameOptions) {
  const spinner = createSpinner("Processing files").start();
  const results: FileRenameResult[] = [];
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  let previewCount = 0;

  try {
    for (const filePath of filePaths) {
      let inputIdentity: FileIdentity | undefined;

      // Check if file exists and is readable
      try {
        const stats = statSync(filePath);
        if (!stats.isFile()) {
          spinner.stop();
          const error = `"${filePath}" is a directory, not a file`;
          if (!isJsonMode()) {
            renderError(new CLIError("FILE_IS_DIRECTORY", error, {
              suggestion: "Provide a path to a specific file",
            }));
          }
          results.push({
            input: { path: filePath, size: 0, mtime: new Date().toISOString() },
            status: "error",
            suggestedName: "",
            applied: false,
            error,
          });
          errorCount++;
          process.exitCode = 1;
          continue;
        }

        // Check file size (25MB limit)
        const maxSize = 25 * 1024 * 1024; // 25MB in bytes
        if (stats.size > maxSize) {
          spinner.stop();
          const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
          const error = `File is too large (${sizeMB}MB)`;
          if (!isJsonMode()) {
            renderError(new CLIError("FILE_TOO_LARGE", error, {
              suggestion: "Maximum file size is 25MB",
              details: filePath,
            }));
          }
          results.push({
            input: { path: filePath, size: stats.size, mtime: stats.mtime.toISOString() },
            status: "error",
            suggestedName: "",
            applied: false,
            error,
          });
          errorCount++;
          process.exitCode = 1;
          continue;
        }

        inputIdentity = getFileIdentity(filePath);
      } catch {
        spinner.stop();
        const error = `Can't find "${filePath}"`;
        if (!isJsonMode()) {
          renderError(new CLIError("FILE_NOT_FOUND", error, {
            suggestion: "Check the file path exists and try again",
          }));
        }
        results.push({
          input: { path: filePath, size: 0, mtime: new Date().toISOString() },
          status: "error",
          suggestedName: "",
          applied: false,
          error,
        });
        errorCount++;
        process.exitCode = 1;
        continue;
      }

      spinner.text = `Processing ${basename(filePath)}`;

      try {
        // Build API fields based on options
        const fields: Array<{ name: string; value: string }> = [];

        if (options.prompt) {
          fields.push({ name: "templateMode", value: "custom" });
          fields.push({ name: "customTemplate", value: options.prompt });
        } else if (options.template) {
          fields.push({ name: "templateMode", value: "predefined" });
          fields.push({ name: "templateId", value: options.template });
        }

        if (options.strategy) {
          fields.push({ name: "strategy", value: options.strategy });
        }

        if (options.language) {
          fields.push({ name: "language", value: options.language });
        }

        // Upload file with optional fields
        const result =
          fields.length > 0
            ? await api.uploadFileWithFields<RenameResult>("/rename", filePath, fields)
            : await api.uploadFile<RenameResult>("/rename", filePath);

        // API returns folderPath, but some versions may return suggestedFolderPath
        const folderPath = result.folderPath ?? result.suggestedFolderPath;

        // Display suggestion with folder path if available
        const displayPath = folderPath
          ? `${folderPath}/${result.suggestedFilename}`
          : result.suggestedFilename;

        if (!isJsonMode()) {
          spinner.stop();
          console.log(chalk.cyan(`\n${result.originalFilename} → ${displayPath}`));

          if (folderPath) {
            console.log(chalk.gray(`  Folder: ${folderPath}`));
          }
        }

        if (options.apply) {
          let newPath: string;

          if (options.outputDir && folderPath) {
            // Use output dir with AI-suggested folder structure
            const targetDir = resolve(options.outputDir, folderPath);
            mkdirSync(targetDir, { recursive: true });
            newPath = join(targetDir, result.suggestedFilename);
          } else if (options.outputDir) {
            // Use output dir without folder structure
            mkdirSync(options.outputDir, { recursive: true });
            newPath = join(options.outputDir, result.suggestedFilename);
          } else {
            // Rename in place
            newPath = join(dirname(filePath), result.suggestedFilename);
          }

          // Handle conflicts
          const resolved = resolveOutputPath(newPath, options.overwrite ?? false);

          if (resolved.skipped) {
            if (!isJsonMode()) {
              console.log(chalk.yellow(`⚠ Skipped (file exists): ${resolved.path}`));
            }
            results.push({
              input: inputIdentity,
              output: { path: resolved.path, folder: folderPath },
              status: "skipped",
              suggestedName: result.suggestedFilename,
              suggestedFolder: folderPath,
              applied: false,
            });
            skippedCount++;
          } else {
            await renameFile(filePath, resolved.path);
            if (!isJsonMode()) {
              console.log(chalk.green(`✓ Moved to: ${resolved.path}`));
            }
            results.push({
              input: inputIdentity,
              output: { path: resolved.path, folder: folderPath },
              status: "renamed",
              suggestedName: result.suggestedFilename,
              suggestedFolder: folderPath,
              applied: true,
            });
            successCount++;
          }
        } else {
          if (!isJsonMode()) {
            console.log(chalk.gray(`Use --apply to rename the file`));
          }
          results.push({
            input: inputIdentity,
            status: "preview",
            suggestedName: result.suggestedFilename,
            suggestedFolder: folderPath,
            applied: false,
          });
          previewCount++;
        }
      } catch (error) {
        spinner.stop();
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!isJsonMode()) {
          if (isCLIError(error)) {
            renderError(error);
          } else {
            console.error(chalk.red(`Error processing ${filePath}: ${errorMessage}`));
          }
        }
        results.push({
          input: inputIdentity!,
          status: "error",
          suggestedName: "",
          applied: false,
          error: errorMessage,
        });
        errorCount++;
        process.exitCode = 1;
      }
    }

    // Output results
    if (isJsonMode()) {
      const jsonResult: RenameResultJson = {
        files: results,
        summary: {
          total: results.length,
          renamed: successCount,
          skipped: skippedCount,
          errors: errorCount,
          previewed: previewCount,
        },
      };
      outputSuccess(jsonResult);
      return;
    }

    // Show appropriate summary based on results
    if (errorCount === 0 && skippedCount === 0) {
      if (previewCount > 0) {
        spinner.succeed(`Previewed ${previewCount} file${previewCount !== 1 ? "s" : ""}`);
      } else {
        spinner.succeed(`Processed ${successCount} file${successCount !== 1 ? "s" : ""}`);
      }
    } else if (successCount === 0 && previewCount === 0) {
      spinner.fail(`Failed to process ${errorCount} file${errorCount !== 1 ? "s" : ""}`);
    } else {
      const parts: string[] = [];
      if (successCount > 0) parts.push(`${successCount} renamed`);
      if (previewCount > 0) parts.push(`${previewCount} previewed`);
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      if (errorCount > 0) parts.push(`${errorCount} failed`);
      spinner.warn(parts.join(", "));
    }
  } catch (error) {
    if (isJsonMode()) {
      const jsonResult: RenameResultJson = {
        files: results,
        summary: {
          total: results.length,
          renamed: successCount,
          skipped: skippedCount,
          errors: errorCount + 1,
          previewed: previewCount,
        },
      };
      outputSuccess(jsonResult);
    } else {
      spinner.fail("Processing failed");
      console.error(chalk.red((error as Error).message));
    }
    process.exitCode = 1;
  }
}
