import type { Clock } from "../ports/clock.js";

/**
 * Real system clock implementation.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  newDate: () => new Date(),
};
