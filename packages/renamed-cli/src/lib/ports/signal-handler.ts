/**
 * Abstraction for process signal handling.
 * Allows testing shutdown logic without actual process signals.
 */
export interface SignalHandler {
  /** Register a callback for shutdown signals (SIGTERM, SIGINT) */
  onShutdown(callback: () => Promise<void>): void;
  /** Remove all registered handlers */
  removeAll(): void;
}
