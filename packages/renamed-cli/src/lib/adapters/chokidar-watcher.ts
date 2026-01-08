import chokidar from "chokidar";
import type { FileWatcher, FileWatcherFactory, FileWatcherOptions } from "../ports/file-watcher.js";

/**
 * Real file watcher factory using chokidar.
 */
export const chokidarWatcherFactory: FileWatcherFactory = {
  create(path: string, options: FileWatcherOptions): FileWatcher {
    const watcher = chokidar.watch(path, {
      persistent: options.persistent,
      ignoreInitial: options.ignoreInitial,
      awaitWriteFinish: options.awaitWriteFinish,
      ignored: options.ignored,
    });

    return {
      on(event: "add" | "change" | "error" | "ready", handler: (arg?: unknown) => void) {
        watcher.on(event, handler as Parameters<typeof watcher.on>[1]);
        return this;
      },
      close() {
        return watcher.close();
      },
    };
  },
};
