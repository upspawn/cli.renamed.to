import type { SignalHandler } from "../ports/signal-handler.js";

/**
 * Create a signal handler for process shutdown signals.
 */
export function createProcessSignalHandler(): SignalHandler {
  const handlers: Array<() => Promise<void>> = [];
  let isHandling = false;

  const handleSignal = async () => {
    if (isHandling) return;
    isHandling = true;
    await Promise.all(handlers.map((h) => h()));
    process.exit(0);
  };

  return {
    onShutdown(callback) {
      handlers.push(callback);
      if (handlers.length === 1) {
        process.on("SIGTERM", handleSignal);
        process.on("SIGINT", handleSignal);
      }
    },
    removeAll() {
      handlers.length = 0;
      process.off("SIGTERM", handleSignal);
      process.off("SIGINT", handleSignal);
    },
  };
}
