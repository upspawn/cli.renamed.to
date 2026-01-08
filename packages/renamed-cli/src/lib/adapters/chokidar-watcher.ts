import chokidar from "chokidar";
import type { FileWatcherFactory, FileWatcherOptions } from "../ports/file-watcher.js";

/**
 * Real file watcher factory using chokidar.
 */
export const chokidarWatcherFactory: FileWatcherFactory = {
  create(path: string, options: FileWatcherOptions) {
    return chokidar.watch(path, {
      persistent: options.persistent,
      ignoreInitial: options.ignoreInitial,
      awaitWriteFinish: options.awaitWriteFinish,
      ignored: options.ignored,
    });
  },
};
