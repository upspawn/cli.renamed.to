import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { statSync } from "fs";
import { rename as renameFile } from "fs/promises";
import { basename } from "path";
import type { ApiClient } from "../lib/api-client.js";

interface RenameOptions {
  apply?: boolean;
}

interface RenameResult {
  originalFilename: string;
  suggestedFilename: string;
}

export function registerRenameCommands(program: Command, api: ApiClient): void {
  const rename = program.command("rename").description("Rename files using AI");

  rename
    .argument("<files...>", "File paths to rename")
    .option("-a, --apply", "Automatically apply the suggested filename")
    .description("Rename files using AI-powered filename suggestions")
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
          console.error(chalk.red(`Error: ${filePath} is not a file`));
          continue;
        }

        // Check file size (25MB limit)
        const maxSize = 25 * 1024 * 1024; // 25MB in bytes
        if (stats.size > maxSize) {
          console.error(chalk.red(`Error: ${filePath} exceeds 25MB limit (${(stats.size / 1024 / 1024).toFixed(2)}MB)`));
          continue;
        }
      } catch (error) {
        console.error(chalk.red(`Error: Cannot access file ${filePath}: ${(error as Error).message}`));
        continue;
      }

      spinner.text = `Processing ${basename(filePath)}`;

      try {
        const result = await api.uploadFile<RenameResult>("/rename", filePath);

        console.log(chalk.cyan(`\n${result.originalFilename} → ${result.suggestedFilename}`));

        if (options.apply) {
          const newPath = filePath.replace(basename(filePath), result.suggestedFilename);
          await renameFile(filePath, newPath);
          console.log(chalk.green(`✓ Renamed to: ${newPath}`));
        } else {
          console.log(chalk.gray(`Use --apply to rename the file`));
        }
      } catch (error) {
        console.error(chalk.red(`Error processing ${filePath}: ${(error as Error).message}`));
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
