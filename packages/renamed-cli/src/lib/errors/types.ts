/**
 * Error codes for all CLI error types.
 * Each code maps to a specific error scenario with predefined messaging.
 */
export type ErrorCode =
  // Authentication errors
  | "AUTH_NOT_AUTHENTICATED"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_REFRESH_FAILED"
  | "AUTH_INVALID_TOKEN"
  // File errors
  | "FILE_NOT_FOUND"
  | "FILE_NOT_READABLE"
  | "FILE_TOO_LARGE"
  | "FILE_UNSUPPORTED_TYPE"
  | "FILE_IS_DIRECTORY"
  // Validation errors
  | "VALIDATION_MISSING_ARG"
  | "VALIDATION_INVALID_OPTION"
  | "VALIDATION_SCHEMA_INVALID"
  | "VALIDATION_CONFIG_INVALID"
  // API errors
  | "API_RATE_LIMITED"
  | "API_QUOTA_EXCEEDED"
  | "API_SERVER_ERROR"
  | "API_BAD_REQUEST"
  | "API_NOT_FOUND"
  // Network errors
  | "NETWORK_OFFLINE"
  | "NETWORK_TIMEOUT"
  // Generic
  | "UNKNOWN_ERROR";

/**
 * Extended Error class for CLI-specific errors with helpful context.
 */
export class CLIError extends Error {
  readonly code: ErrorCode;
  readonly suggestion?: string;
  readonly example?: string;
  readonly examples?: string[];
  readonly docs?: string;
  readonly details?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      suggestion?: string;
      example?: string;
      examples?: string[];
      docs?: string;
      details?: string;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = "CLIError";
    this.code = code;
    this.suggestion = options?.suggestion;
    this.example = options?.example;
    this.examples = options?.examples;
    this.docs = options?.docs;
    this.details = options?.details;
  }
}

/**
 * Type guard to check if an error is a CLIError.
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof CLIError;
}
