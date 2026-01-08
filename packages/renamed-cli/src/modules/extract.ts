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

export interface SchemaField {
  name: string;
  type: "string" | "number" | "date" | "currency" | "boolean";
  instruction?: string;
}

export interface SchemaTableColumn {
  name: string;
  type: "string" | "number" | "date" | "currency" | "boolean";
  instruction?: string;
}

export interface SchemaTable {
  name: string;
  instruction?: string;
  columns: SchemaTableColumn[];
}

export interface ExtractionSchema {
  fields?: SchemaField[];
  tables?: SchemaTable[];
}

export interface ExtractedField {
  name: string;
  value: unknown;
  confidence?: number;
}

export interface ExtractedTableRow {
  [column: string]: unknown;
}

export interface ExtractedTable {
  name: string;
  rows: ExtractedTableRow[];
}

export interface ExtractResponse {
  fields?: ExtractedField[];
  tables?: ExtractedTable[];
  metadata?: {
    pageCount?: number;
    processingTimeMs?: number;
  };
}

/**
 * Row data for fields table output.
 */
export interface FieldRowData {
  name: string;
  value: string;
  confidence: string;
}

/**
 * Data structure for table output.
 */
export interface TableData {
  name: string;
  columns: string[];
  rows: string[][];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

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
    throw new Error(`File exceeds 25MB limit (${sizeMB}MB): ${filePath}`);
  }
}

/**
 * Parse inline JSON schema string.
 */
export function parseInlineSchema(schema: string): ExtractionSchema {
  try {
    return JSON.parse(schema) as ExtractionSchema;
  } catch {
    throw new Error("Invalid JSON in --schema option");
  }
}

/**
 * Parse schema from file content.
 */
export function parseSchemaContent(
  content: string,
  filePath: string
): ExtractionSchema {
  try {
    return JSON.parse(content) as ExtractionSchema;
  } catch (error) {
    throw new Error(`Failed to parse schema file: ${(error as Error).message}`);
  }
}

function parseSchema(options: ExtractOptions): ExtractionSchema | undefined {
  if (options.parserId) {
    // Parser ID takes precedence - schema is on the server
    return undefined;
  }

  if (options.schema) {
    return parseInlineSchema(options.schema);
  }

  if (options.schemaFile) {
    try {
      const content = readFileSync(options.schemaFile, "utf-8");
      return parseSchemaContent(content, options.schemaFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Schema file not found: ${options.schemaFile}`);
      }
      throw error;
    }
  }

  // Discovery mode - no schema provided
  return undefined;
}

// ---------------------------------------------------------------------------
// Output Formatting (Pure Functions)
// ---------------------------------------------------------------------------

/**
 * Format a value for display. Returns "(empty)" for null/undefined,
 * JSON string for objects, or string representation otherwise.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "(empty)";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format confidence as a percentage string.
 */
export function formatConfidence(confidence: number | undefined): string {
  return confidence != null ? `${(confidence * 100).toFixed(0)}%` : "-";
}

/**
 * Build field row data for table output.
 */
export function buildFieldRow(field: ExtractedField): FieldRowData {
  return {
    name: field.name,
    value: formatValue(field.value),
    confidence: formatConfidence(field.confidence),
  };
}

/**
 * Build all field rows from extracted fields.
 */
export function buildFieldRows(fields: ExtractedField[]): FieldRowData[] {
  return fields.map(buildFieldRow);
}

/**
 * Build table data from an extracted table.
 */
export function buildTableData(table: ExtractedTable): TableData {
  if (table.rows.length === 0) {
    return { name: table.name, columns: [], rows: [] };
  }

  const columns = Object.keys(table.rows[0]);
  const rows = table.rows.map((row) =>
    columns.map((col) => formatValue(row[col]))
  );

  return { name: table.name, columns, rows };
}

/**
 * Format metadata for display.
 */
export function formatMetadata(metadata: ExtractResponse["metadata"]): string[] {
  if (!metadata) return [];

  const lines: string[] = [];
  lines.push(`Pages: ${metadata.pageCount ?? "unknown"}`);
  if (metadata.processingTimeMs) {
    lines.push(`Processing time: ${metadata.processingTimeMs}ms`);
  }
  return lines;
}

function formatAsTable(response: ExtractResponse): void {
  if (response.fields && response.fields.length > 0) {
    console.log(chalk.bold("\nExtracted Fields:"));
    const fieldsTable = new CliTable3({
      head: [chalk.cyan("Field"), chalk.cyan("Value"), chalk.cyan("Confidence")],
      colWidths: [25, 45, 12],
    });

    for (const row of buildFieldRows(response.fields)) {
      fieldsTable.push([
        row.name,
        row.value === "(empty)" ? chalk.gray(row.value) : row.value,
        row.confidence,
      ]);
    }

    console.log(fieldsTable.toString());
  }

  if (response.tables && response.tables.length > 0) {
    for (const table of response.tables) {
      console.log(chalk.bold(`\nTable: ${table.name}`));

      const tableData = buildTableData(table);
      if (tableData.rows.length === 0) {
        console.log(chalk.gray("  (no rows)"));
        continue;
      }

      const tableOutput = new CliTable3({
        head: tableData.columns.map((c) => chalk.cyan(c)),
      });

      for (const row of tableData.rows) {
        tableOutput.push(row);
      }

      console.log(tableOutput.toString());
    }
  }

  const metadataLines = formatMetadata(response.metadata);
  if (metadataLines.length > 0) {
    console.log("");
    for (const line of metadataLines) {
      console.log(chalk.gray(line));
    }
  }
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
