/**
 * Abstraction for time-related operations.
 * Allows injecting fake clocks for testing.
 */
export interface Clock {
  /** Get current timestamp in milliseconds */
  now(): number;
  /** Create a new Date instance */
  newDate(): Date;
}
