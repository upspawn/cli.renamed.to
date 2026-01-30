import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Mocks (must be declared before imports that use them)
// ---------------------------------------------------------------------------

const mockChokidarWatch = vi.fn();

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}));

vi.mock("chokidar", () => ({
  default: {
    watch: (...args: unknown[]) => mockChokidarWatch(...args),
  },
}));

vi.mock("../lib/config.js", () => ({
  loadConfig: vi.fn(() => ({
    config: {
      concurrency: 2,
      debounceMs: 1000,
      retryAttempts: 3,
      retryDelayMs: 5000,
      healthSocketPath: "/tmp/renamed-health.sock",
      healthEnabled: false,
      patterns: ["*.pdf"],
      logLevel: "info" as const,
      logJson: false,
      usePolling: false,
      pollIntervalMs: 500,
    },
    sources: [],
  })),
}));

vi.mock("../lib/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  })),
}));

vi.mock("../lib/queue.js", () => ({
  createQueue: vi.fn(() => ({
    enqueue: vi.fn(),
    getStats: vi.fn(() => ({
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      averageLatencyMs: 0,
    })),
    drain: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: vi.fn(() => false),
  })),
}));

vi.mock("../lib/health.js", () => ({
  createHealthServer: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    recordSuccess: vi.fn(),
    recordError: vi.fn(),
    updateStats: vi.fn(),
  })),
}));

vi.mock("../lib/cli-context.js", () => ({
  isJsonMode: () => false,
}));

vi.mock("../lib/json-output.js", () => ({
  outputNdjson: vi.fn(),
}));

vi.mock("../lib/file-identity.js", () => ({
  getFileIdentity: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { registerWatchCommands } from "./watch.js";
import type { ApiClient } from "../lib/api-client.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockApi(): ApiClient {
  return {
    uploadFile: vi.fn(),
    setLegacyToken: vi.fn(),
    clearToken: vi.fn(),
    storeOAuthTokens: vi.fn(),
    get: vi.fn(),
  } as unknown as ApiClient;
}

function createMockWatcher() {
  const watcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return watcher;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("watch command polling integration", () => {
  let program: Command;
  let api: ApiClient;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();

    program = new Command();
    program.exitOverride();
    api = createMockApi();

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    // Default: return a mock watcher
    mockChokidarWatch.mockReturnValue(createMockWatcher());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it("passes usePolling and interval to chokidar when --poll is set", async () => {
    registerWatchCommands(program, api);

    await program.parseAsync(["node", "test", "watch", "/tmp/test-watch", "--poll"]);

    expect(mockChokidarWatch).toHaveBeenCalledTimes(1);

    const [, options] = mockChokidarWatch.mock.calls[0];
    expect(options.usePolling).toBe(true);
    expect(options.interval).toBe(500); // default pollIntervalMs
  });

  it("passes custom poll interval to chokidar", async () => {
    registerWatchCommands(program, api);

    await program.parseAsync([
      "node", "test", "watch", "/tmp/test-watch",
      "--poll", "--poll-interval", "1500",
    ]);

    expect(mockChokidarWatch).toHaveBeenCalledTimes(1);

    const [, options] = mockChokidarWatch.mock.calls[0];
    expect(options.usePolling).toBe(true);
    expect(options.interval).toBe(1500);
  });

  it("does not pass usePolling when --poll is not set", async () => {
    registerWatchCommands(program, api);

    await program.parseAsync(["node", "test", "watch", "/tmp/test-watch"]);

    expect(mockChokidarWatch).toHaveBeenCalledTimes(1);

    const [, options] = mockChokidarWatch.mock.calls[0];
    expect(options.usePolling).toBeUndefined();
    expect(options.interval).toBeUndefined();
  });

  it("rejects poll interval below 100", async () => {
    registerWatchCommands(program, api);

    await program.parseAsync([
      "node", "test", "watch", "/tmp/test-watch",
      "--poll", "--poll-interval", "50",
    ]);

    expect(process.exitCode).toBe(1);
    expect(mockChokidarWatch).not.toHaveBeenCalled();
  });

  it("rejects poll interval above 10000", async () => {
    registerWatchCommands(program, api);

    await program.parseAsync([
      "node", "test", "watch", "/tmp/test-watch",
      "--poll", "--poll-interval", "20000",
    ]);

    expect(process.exitCode).toBe(1);
    expect(mockChokidarWatch).not.toHaveBeenCalled();
  });

  it("rejects non-numeric poll interval", async () => {
    registerWatchCommands(program, api);

    await program.parseAsync([
      "node", "test", "watch", "/tmp/test-watch",
      "--poll", "--poll-interval", "abc",
    ]);

    expect(process.exitCode).toBe(1);
    expect(mockChokidarWatch).not.toHaveBeenCalled();
  });
});
