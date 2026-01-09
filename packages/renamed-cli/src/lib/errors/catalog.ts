import { CLIError } from "./types.js";

/**
 * Error catalog - factory functions for creating CLIErrors with helpful context.
 * Each function produces a consistent, user-friendly error message.
 */

// ============================================================================
// Authentication Errors
// ============================================================================

export function notAuthenticated(): CLIError {
  return new CLIError("AUTH_NOT_AUTHENTICATED", "You need to log in first", {
    suggestion: "Run the command below to authenticate (opens browser)",
    example: "renamed auth login",
    docs: "https://www.renamed.to/docs/cli/auth",
  });
}

export function tokenExpired(): CLIError {
  return new CLIError("AUTH_TOKEN_EXPIRED", "Your session has expired", {
    suggestion: "Log in again to continue (opens browser)",
    example: "renamed auth login",
  });
}

export function refreshFailed(details?: string): CLIError {
  return new CLIError("AUTH_REFRESH_FAILED", "Couldn't refresh your session", {
    suggestion: "Your session may have been revoked. Log in again",
    example: "renamed auth login",
    details,
  });
}

export function invalidToken(details?: string): CLIError {
  return new CLIError("AUTH_INVALID_TOKEN", "Your credentials are invalid", {
    suggestion: "Log in again to get new credentials",
    example: "renamed auth login",
    details,
  });
}

// ============================================================================
// File Errors
// ============================================================================

export function fileNotFound(path: string): CLIError {
  return new CLIError("FILE_NOT_FOUND", `Can't find "${path}"`, {
    suggestion: "Check the file path exists and try again",
  });
}

export function fileNotReadable(path: string, reason?: string): CLIError {
  return new CLIError("FILE_NOT_READABLE", `Can't read "${path}"`, {
    suggestion: "Check file permissions or if another app has it open",
    details: reason,
  });
}

export function fileTooLarge(path: string, sizeBytes: number, limitBytes: number): CLIError {
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
  const limitMB = (limitBytes / 1024 / 1024).toFixed(0);
  return new CLIError("FILE_TOO_LARGE", `File is too large (${sizeMB}MB)`, {
    suggestion: `Maximum file size is ${limitMB}MB`,
    details: path,
  });
}

export function unsupportedFileType(path: string, supportedTypes: string[]): CLIError {
  const ext = path.split(".").pop() || "unknown";
  return new CLIError("FILE_UNSUPPORTED_TYPE", `".${ext}" files aren't supported`, {
    suggestion: `Supported formats: ${supportedTypes.join(", ")}`,
  });
}

export function fileIsDirectory(path: string): CLIError {
  return new CLIError("FILE_IS_DIRECTORY", `"${path}" is a directory, not a file`, {
    suggestion: "Provide a path to a specific file",
  });
}

// ============================================================================
// Validation Errors
// ============================================================================

export function missingArgument(
  argName: string,
  command: string,
  _usage?: string,
  examples?: string[]
): CLIError {
  return new CLIError("VALIDATION_MISSING_ARG", `Missing ${argName}`, {
    suggestion: `The "${command}" command requires ${argName}`,
    examples: examples?.length ? examples : [`renamed ${command} --help`],
  });
}

export function invalidOption(optionName: string, reason: string, validValues?: string[]): CLIError {
  return new CLIError("VALIDATION_INVALID_OPTION", `Invalid --${optionName}: ${reason}`, {
    suggestion: validValues?.length
      ? `Choose from: ${validValues.join(", ")}`
      : undefined,
  });
}

export function invalidSchema(reason: string): CLIError {
  return new CLIError("VALIDATION_SCHEMA_INVALID", `Invalid schema: ${reason}`, {
    suggestion: "Check your JSON syntax",
    examples: [
      "renamed extract doc.pdf",
      'renamed extract doc.pdf -s \'{"fields":[{"name":"total","type":"currency"}]}\'',
    ],
  });
}

export function invalidConfig(path: string, issues: string[]): CLIError {
  const details = issues.length > 1
    ? issues.map((i) => `• ${i}`).join("\n")
    : issues[0];
  return new CLIError("VALIDATION_CONFIG_INVALID", `Config file has errors`, {
    suggestion: "Fix the issues below and try again",
    details,
  });
}

// ============================================================================
// API Errors
// ============================================================================

export function rateLimited(retryAfterSeconds?: number): CLIError {
  const wait = retryAfterSeconds
    ? `${retryAfterSeconds} seconds`
    : "a moment";
  return new CLIError("API_RATE_LIMITED", "Slow down! Too many requests", {
    suggestion: `Wait ${wait} and try again`,
  });
}

export function quotaExceeded(): CLIError {
  return new CLIError("API_QUOTA_EXCEEDED", "You've reached your monthly limit", {
    suggestion: "Upgrade your plan or wait for the next billing cycle",
    docs: "https://www.renamed.to/pricing",
  });
}

export function serverError(details?: string): CLIError {
  return new CLIError("API_SERVER_ERROR", "Something went wrong on our end", {
    suggestion: "This is temporary. Please try again in a few minutes",
    details,
  });
}

export function badRequest(details?: string): CLIError {
  return new CLIError("API_BAD_REQUEST", "The request couldn't be processed", {
    suggestion: details || "Check your input and try again",
  });
}

export function apiNotFound(resource?: string): CLIError {
  const message = resource ? `Not found: ${resource}` : "Resource not found";
  return new CLIError("API_NOT_FOUND", message, {
    suggestion: "Check the ID or path is correct",
  });
}

// ============================================================================
// Network Errors
// ============================================================================

export function networkOffline(): CLIError {
  return new CLIError("NETWORK_OFFLINE", "Can't connect to renamed.to", {
    suggestion: "Check your internet connection and try again",
  });
}

export function networkTimeout(): CLIError {
  return new CLIError("NETWORK_TIMEOUT", "Request timed out", {
    suggestion: "The server might be busy. Try again in a moment",
  });
}

// ============================================================================
// Generic Error
// ============================================================================

export function unknownError(error: unknown): CLIError {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;
  return new CLIError("UNKNOWN_ERROR", message, { cause });
}

// ============================================================================
// HTTP Status Code Mapping
// ============================================================================

/**
 * Convert an HTTP error response to a CLIError.
 */
export function fromHttpStatus(
  status: number,
  statusText: string,
  payload?: unknown
): CLIError {
  const details = extractErrorMessage(payload);

  switch (status) {
    case 401:
      return notAuthenticated();
    case 403:
      // Could be expired token or insufficient permissions
      if (details?.toLowerCase().includes("expired")) {
        return tokenExpired();
      }
      return invalidToken(details);
    case 404:
      return apiNotFound(details);
    case 429:
      return rateLimited();
    case 400:
      return badRequest(details);
    case 402:
      return quotaExceeded();
    default:
      if (status >= 500) {
        return serverError(details ?? `${status} ${statusText}`);
      }
      return new CLIError(
        "UNKNOWN_ERROR",
        `Request failed (${status} ${statusText})`,
        { details }
      );
  }
}

/**
 * Extract error message from API response payload.
 */
function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload) return undefined;
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    return (
      (obj.error_description as string) ??
      (obj.error as string) ??
      (obj.message as string) ??
      JSON.stringify(payload)
    );
  }
  return undefined;
}
