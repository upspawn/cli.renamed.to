/**
 * Abstraction for timer operations.
 * Allows injecting fake timers for testing.
 */
export interface TimerService {
  setTimeout(fn: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(id: NodeJS.Timeout): void;
}

/**
 * Promise-based delay function type.
 * Useful for polling and retry logic.
 */
export type DelayFn = (ms: number) => Promise<void>;
