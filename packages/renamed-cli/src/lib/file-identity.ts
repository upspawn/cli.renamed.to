/**
 * File identity utilities for tracking file metadata.
 * Provides hash, size, and mtime for idempotency and verification.
 */

import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import type { FileIdentity } from "./json-output.js";

/**
 * Get file identity information including size, mtime, and optionally hash.
 */
export function getFileIdentity(filePath: string, includeHash = false): FileIdentity {
  const stats = statSync(filePath);

  const identity: FileIdentity = {
    path: filePath,
    size: stats.size,
    mtime: stats.mtime.toISOString(),
  };

  if (includeHash) {
    identity.hash = computeFileHash(filePath);
  }

  return identity;
}

/**
 * Compute MD5 hash of a file.
 */
export function computeFileHash(filePath: string, algorithm = "md5"): string {
  const content = readFileSync(filePath);
  return createHash(algorithm).update(content).digest("hex");
}

/**
 * Check if a file has changed based on size and mtime.
 * Fast check without reading file contents.
 */
export function hasFileChanged(
  filePath: string,
  previousIdentity: FileIdentity
): boolean {
  try {
    const stats = statSync(filePath);
    return (
      stats.size !== previousIdentity.size ||
      stats.mtime.toISOString() !== previousIdentity.mtime
    );
  } catch {
    // File might have been deleted
    return true;
  }
}

/**
 * Check if a file has changed based on hash.
 * More accurate but slower than size/mtime check.
 */
export function hasFileHashChanged(
  filePath: string,
  previousHash: string,
  algorithm = "md5"
): boolean {
  try {
    const currentHash = computeFileHash(filePath, algorithm);
    return currentHash !== previousHash;
  } catch {
    return true;
  }
}

/**
 * Generate a unique suffix for conflict resolution.
 */
export function generateConflictSuffix(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${timestamp}-${random}`;
}
