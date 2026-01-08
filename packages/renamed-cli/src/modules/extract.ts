import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import CliTable3 from "cli-table3";
import { statSync, readFileSync } from "fs";
import { basename } from "path";
import type { ApiClient, MultipartField } from "../lib/api-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractOptions {
  schema?: string;
  schemaFile?: string;
  parserId?: string;
  instructions?: string;
  output?: "json" | "table";
}

interface SchemaField {
  name: string;
  type: "string" | "number" | "date" | "currency" | "boolean";
  instruction?: string;
}

interface SchemaTableColumn {
  name: string;
  type: "string" | "number" | "date" | "currency" | "boolean";
  instruction?: string;
}

interface SchemaTable {
  name: string;
  instruction?: string;
  columns: SchemaTableColumn[];
}

interface ExtractionSchema {
  fields?: SchemaField[];
  tables?: SchemaTable[];
}

interface ExtractedField {
  name: string;
  value: unknown;
  confidence?: number;
}

interface ExtractedTableRow {
  [column: string]: unknown;
}

interface ExtractedTable {
  name: string;
  rows: ExtractedTableRow[];
}

interface ExtractResponse {
  fields?: ExtractedField[];
  tables?: ExtractedTable[];
  metadata?: {
    pageCount?: number;
    processingTimeMs?: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

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
    throw new Error(`File exceeds 25MB limit (${sizeMB}MB): ${filePath}`);
  }
}

function parseSchema(options: ExtractOptions): ExtractionSchema | undefined {
  if (options.parserId) {
    // Parser ID takes precedence - schema is on the server
    return undefined;
  }

  if (options.schema) {
    try {
      return JSON.parse(options.schema) as ExtractionSchema;
    } catch {
      throw new Error("Invalid JSON in --schema option");
    }
  }

  if (options.schemaFile) {
    try {
      const content = readFileSync(options.schemaFile, "utf-8");
      return JSON.parse(content) as ExtractionSchema;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Schema file not found: ${options.schemaFile}`);
      }
      throw new Error(`Failed to parse schema file: ${(error as Error).message}`);
    }
  }

  // Discovery mode - no schema provided
  return undefined;
}

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

function formatAsTable(response: ExtractResponse): void {
  if (response.fields && response.fields.length > 0) {
    console.log(chalk.bold("\nExtracted Fields:"));
    const fieldsTable = new CliTable3({
      head: [chalk.cyan("Field"), chalk.cyan("Value"), chalk.cyan("Confidence")],
      colWidths: [25, 45, 12]
    });

    for (const field of response.fields) {
      const value = formatValue(field.value);
      const confidence = field.confidence != null ? `${(field.confidence * 100).toFixed(0)}%` : "-";
      fieldsTable.push([field.name, value, confidence]);
    }

    console.log(fieldsTable.toString());
  }

  if (response.tables && response.tables.length > 0) {
    for (const table of response.tables) {
      console.log(chalk.bold(`\nTable: ${table.name}`));

      if (table.rows.length === 0) {
        console.log(chalk.gray("  (no rows)"));
        continue;
      }

      const columns = Object.keys(table.rows[0]);
      const tableOutput = new CliTable3({
        head: columns.map((c) => chalk.cyan(c))
      });

      for (const row of table.rows) {
        tableOutput.push(columns.map((col) => formatValue(row[col])));
      }

      console.log(tableOutput.toString());
    }
  }

  if (response.metadata) {
    console.log(chalk.gray(`\nPages: ${response.metadata.pageCount ?? "unknown"}`));
    if (response.metadata.processingTimeMs) {
      console.log(chalk.gray(`Processing time: ${response.metadata.processingTimeMs}ms`));
    }
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray("(empty)");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatAsJson(response: ExtractResponse): void {
  console.log(JSON.stringify(response, null, 2));
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

export async function extractFromFile(
  api: ApiClient,
  filePath: string,
  options: ExtractOptions
): Promise<ExtractResponse> {
  validateFilePath(filePath);

  const schema = parseSchema(options);
  const fields: MultipartField[] = [];

  if (options.parserId) {
    fields.push({ name: "parserId", value: options.parserId });
  } else if (schema) {
    fields.push({ name: "schema", value: JSON.stringify(schema) });
  }

  if (options.instructions) {
    fields.push({ name: "instructions", value: options.instructions });
  }

  return api.uploadFileWithFields<ExtractResponse>("/extract", filePath, fields);
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerExtractCommands(program: Command, api: ApiClient): void {
  program
    .command("extract")
    .description("Extract structured data from PDF documents")
    .argument("<file>", "PDF file to extract data from")
    .option("-s, --schema <json>", "Inline JSON schema defining fields to extract")
    .option("-f, --schema-file <path>", "Path to JSON file containing extraction schema")
    .option("-p, --parser-id <id>", "UUID of a saved parser template")
    .option("-i, --instructions <text>", "Document-level context for AI extraction")
    .option("-o, --output <format>", "Output format: json or table", "table")
    .action(async (file: string, options: ExtractOptions) => {
      const outputFormat = options.output === "json" ? "json" : "table";
      const spinner = ora(`Extracting data from ${basename(file)}`).start();

      try {
        const result = await extractFromFile(api, file, options);
        spinner.succeed("Extraction complete");

        if (outputFormat === "json") {
          formatAsJson(result);
        } else {
          formatAsTable(result);
        }
      } catch (error) {
        spinner.fail("Extraction failed");
        console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}
