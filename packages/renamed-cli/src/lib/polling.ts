import type { DelayFn } from "./ports/timer.js";
import { realDelay } from "./adapters/real-timers.js";

/**
 * Options for the generic polling function.
 */
export interface PollingOptions<T> {
  /** Function to fetch current status */
  fetchStatus: () => Promise<T>;
  /** Check if polling should complete successfully */
  isComplete: (result: T) => boolean;
  /** Check if polling should fail */
  isFailed: (result: T) => { failed: true; error: string } | { failed: false };
  /** Interval between polls in milliseconds */
  intervalMs: number;
  /** Maximum number of poll attempts */
  maxAttempts: number;
  /** Optional callback for progress updates */
  onProgress?: (result: T) => void;
  /** Optional delay function for testing */
  delay?: DelayFn;
}

/**
 * Generic polling function with configurable completion/failure checks.
 * Useful for waiting on async job completion.
 */
export async function poll<T>(options: PollingOptions<T>): Promise<T> {
  const {
    fetchStatus,
    isComplete,
    isFailed,
    intervalMs,
    maxAttempts,
    onProgress,
    delay = realDelay,
  } = options;

  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    const result = await fetchStatus();

    if (isComplete(result)) {
      return result;
    }

    const failCheck = isFailed(result);
    if (failCheck.failed) {
      throw new Error(failCheck.error);
    }

    onProgress?.(result);
    await delay(intervalMs);
  }

  throw new Error("Polling timed out");
}
