import type { TimerService, DelayFn } from "../ports/timer.js";

/**
 * Real timer service using global setTimeout/clearTimeout.
 */
export const realTimerService: TimerService = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

/**
 * Real delay function using setTimeout.
 */
export const realDelay: DelayFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));
