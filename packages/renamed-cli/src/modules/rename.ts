import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { statSync, mkdirSync } from "fs";
import { rename as renameFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import type { ApiClient } from "../lib/api-client.js";
import { isCLIError, renderError, CLIError } from "../lib/errors/index.js";

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

type TemplateMode = "auto" | "predefined" | "custom";

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
}

interface RenameResult {
  originalFilename: string;
  suggestedFilename: string;
  folderPath?: string;
  // Legacy field name (keeping for backwards compatibility)
  suggestedFolderPath?: string;
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

${chalk.bold.cyan("Examples:")}
  renamed rename invoice.pdf
      ${chalk.gray("Preview AI-suggested filename")}

  renamed rename -a invoice.pdf
      ${chalk.gray("Rename file with AI suggestion")}

  renamed rename -a *.pdf
      ${chalk.gray("Batch rename all PDFs in current directory")}

  renamed rename -p "Format: YYYY-MM-DD_CompanyName_Type" invoice.pdf
      ${chalk.gray("Use custom naming instruction")}

  renamed rename -s by_date -o ~/Documents -a invoice.pdf
      ${chalk.gray("Organize into date-based folders")}

  renamed rename -t date_first -l de -a rechnung.pdf
      ${chalk.gray("German output with date-first template")}
`
    )
    .action((files: string[], options: RenameOptions) => renameFiles(api, files, options));
}

export async function renameFiles(api: ApiClient, filePaths: string[], options: RenameOptions) {
  const spinner = ora("Processing files").start();

  try {
    for (const filePath of filePaths) {
      // Check if file exists and is readable
      try {
        const stats = statSync(filePath);
        if (!stats.isFile()) {
          renderError(new CLIError("FILE_IS_DIRECTORY", `"${filePath}" is a directory, not a file`, {
            suggestion: "Provide a path to a specific file",
          }));
          continue;
        }

        // Check file size (25MB limit)
        const maxSize = 25 * 1024 * 1024; // 25MB in bytes
        if (stats.size > maxSize) {
          const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
          renderError(new CLIError("FILE_TOO_LARGE", `File is too large (${sizeMB}MB)`, {
            suggestion: "Maximum file size is 25MB",
            details: filePath,
          }));
          continue;
        }
      } catch (error) {
        renderError(new CLIError("FILE_NOT_FOUND", `Can't find "${filePath}"`, {
          suggestion: "Check the file path exists and try again",
        }));
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
        console.log(chalk.cyan(`\n${result.originalFilename} → ${displayPath}`));

        if (folderPath) {
          console.log(chalk.gray(`  Folder: ${folderPath}`));
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

          await renameFile(filePath, newPath);
          console.log(chalk.green(`✓ Moved to: ${newPath}`));
        } else {
          console.log(chalk.gray(`Use --apply to rename the file`));
        }
      } catch (error) {
        if (isCLIError(error)) {
          renderError(error);
        } else {
          console.error(chalk.red(`Error processing ${filePath}: ${(error as Error).message}`));
        }
        process.exitCode = 1;
      }
    }

    spinner.succeed("Processing complete");
  } catch (error) {
    spinner.fail("Processing failed");
    console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
  }
}
