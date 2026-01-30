/**
 * Abstraction for file system watching.
 * Allows testing watch logic without actual file system events.
 */
export interface FileWatcher {
  on(event: "add" | "change" | "error" | "ready", handler: (arg?: unknown) => void): this;
  close(): Promise<void>;
}

export interface FileWatcherOptions {
  persistent?: boolean;
  ignoreInitial?: boolean;
  awaitWriteFinish?: {
    stabilityThreshold?: number;
    pollInterval?: number;
  };
  ignored?: (string | RegExp)[];
  usePolling?: boolean;
  interval?: number;
}

export interface FileWatcherFactory {
  create(path: string, options: FileWatcherOptions): FileWatcher;
}
