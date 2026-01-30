/**
 * JSON output utilities for machine-readable CLI output.
 * Provides consistent schemas and output helpers.
 */

import { isJsonMode } from "./cli-context.js";
import { CLIError } from "./errors/types.js";

// ============================================================================
// Base Types
// ============================================================================

export interface FileIdentity {
  path: string;
  size: number;
  mtime: string; // ISO 8601
  hash?: string; // MD5 or SHA256
}

export interface JsonSuccess<T> {
  success: true;
  data: T;
  meta?: {
    requestId?: string;
    duration?: number;
    version?: string;
  };
}

export interface JsonError {
  success: false;
  error: {
    code: string;
    message: string;
    suggestion?: string;
    details?: string;
    docs?: string;
  };
  meta?: {
    requestId?: string;
    version?: string;
  };
}

export type JsonResult<T> = JsonSuccess<T> | JsonError;

// ============================================================================
// Command-Specific Schemas
// ============================================================================

export interface RenameResultJson {
  files: Array<{
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
  }>;
  summary: {
    total: number;
    renamed: number;
    skipped: number;
    errors: number;
    previewed: number;
  };
}

export interface ExtractResultJson {
  file: FileIdentity;
  fields?: Array<{
    name: string;
    value: unknown;
    confidence?: number;
  }>;
  tables?: Array<{
    name: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
  }>;
  metadata?: {
    pageCount?: number;
    processingTimeMs?: number;
  };
}

export interface PdfSplitResultJson {
  input: FileIdentity;
  mode: string;
  outputFiles: Array<{
    path: string;
    pages: number[];
    size?: number;
  }>;
  summary: {
    totalPages: number;
    outputCount: number;
  };
}

export interface WatchEventJson {
  type: "start" | "file" | "error" | "passthrough" | "stop";
  timestamp: string;
  data?: {
    file?: FileIdentity;
    result?: {
      suggestedName: string;
      suggestedFolder?: string;
      applied: boolean;
      outputPath?: string;
    };
    error?: string;
    passthroughPath?: string;
  };
}

export interface AuthStatusJson {
  authenticated: boolean;
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
  token?: {
    expiresAt?: string;
    scope?: string;
    type?: string;
  };
}

export interface DoctorResultJson {
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "warn";
    message: string;
    details?: string;
  }>;
  system: {
    os: string;
    nodeVersion: string;
    cliVersion: string;
    configPath?: string;
  };
  network: {
    baseUrl: string;
    reachable: boolean;
    latencyMs?: number;
  };
  auth: {
    hasCredentials: boolean;
    tokenExpiry?: string;
  };
}

export interface ConfigShowJson {
  effective: Record<string, unknown>;
  sources: {
    flags: Record<string, unknown>;
    env: Record<string, unknown>;
    file: Record<string, unknown>;
    defaults: Record<string, unknown>;
  };
  configPath?: string;
}

// ============================================================================
// Output Functions
// ============================================================================

/**
 * Output a successful JSON result to stdout.
 */
export function outputSuccess<T>(data: T, meta?: JsonSuccess<T>["meta"]): void {
  const result: JsonSuccess<T> = {
    success: true,
    data,
    ...(meta && { meta }),
  };
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output an error JSON result to stderr.
 */
export function outputError(error: CLIError | Error, meta?: JsonError["meta"]): void {
  const result: JsonError = {
    success: false,
    error: {
      code: error instanceof CLIError ? error.code : "UNKNOWN_ERROR",
      message: error.message,
      ...(error instanceof CLIError && error.suggestion && { suggestion: error.suggestion }),
      ...(error instanceof CLIError && error.details && { details: error.details }),
      ...(error instanceof CLIError && error.docs && { docs: error.docs }),
    },
    ...(meta && { meta }),
  };
  console.error(JSON.stringify(result, null, 2));
}

/**
 * Output an NDJSON event (for streaming, like watch).
 */
export function outputNdjson(event: WatchEventJson): void {
  console.log(JSON.stringify(event));
}

/**
 * Conditionally output JSON or return false for human output.
 * Use this to check if JSON mode is enabled before outputting.
 */
export function maybeOutputJson<T>(data: T, meta?: JsonSuccess<T>["meta"]): boolean {
  if (isJsonMode()) {
    outputSuccess(data, meta);
    return true;
  }
  return false;
}

/**
 * Conditionally output error JSON or return false for human output.
 */
export function maybeOutputErrorJson(error: CLIError | Error, meta?: JsonError["meta"]): boolean {
  if (isJsonMode()) {
    outputError(error, meta);
    return true;
  }
  return false;
}
