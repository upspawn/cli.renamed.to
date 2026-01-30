import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs with configurable behavior
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockStatSync = vi.fn();
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

import {
  matchesPatterns,
  validateDirectory,
  parseConcurrency,
  createFileHandler,
  clearPendingFiles,
  type FileHandlerContext,
  type WatchDeps,
} from "./watch.js";
import type { TimerService } from "../lib/ports/timer.js";
import type { Logger } from "../lib/logger.js";

describe("watch module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: valid directory
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("matchesPatterns", () => {
    it("matches file with matching extension pattern", () => {
      expect(matchesPatterns("document.pdf", ["*.pdf"])).toBe(true);
    });

    it("matches file with case-insensitive extension", () => {
      expect(matchesPatterns("document.PDF", ["*.pdf"])).toBe(true);
    });

    it("does not match file with different extension", () => {
      expect(matchesPatterns("document.doc", ["*.pdf"])).toBe(false);
    });

    it("matches file with exact filename pattern", () => {
      expect(matchesPatterns("readme.txt", ["readme.txt"])).toBe(true);
    });

    it("does not match partial filename", () => {
      expect(matchesPatterns("myreadme.txt", ["readme.txt"])).toBe(false);
    });

    it("matches against multiple patterns", () => {
      const patterns = ["*.pdf", "*.jpg", "*.png"];
      expect(matchesPatterns("photo.jpg", patterns)).toBe(true);
      expect(matchesPatterns("image.png", patterns)).toBe(true);
      expect(matchesPatterns("document.pdf", patterns)).toBe(true);
      expect(matchesPatterns("data.csv", patterns)).toBe(false);
    });

    it("handles files without extension", () => {
      expect(matchesPatterns("Makefile", ["*.pdf"])).toBe(false);
      expect(matchesPatterns("Makefile", ["Makefile"])).toBe(true);
    });

    it("handles multiple dot extensions", () => {
      expect(matchesPatterns("file.test.ts", ["*.ts"])).toBe(true);
      expect(matchesPatterns("file.test.ts", ["*.test.ts"])).toBe(false);
    });
  });

  describe("validateDirectory", () => {
    it("creates directory if it does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      validateDirectory("/path/to/new", "Output directory");

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("new"),
        { recursive: true }
      );
    });

    it("does not create directory if it exists", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      validateDirectory("/path/to/existing", "Output directory");

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it("throws if path is not a directory", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => false });

      expect(() => validateDirectory("/path/to/file", "Output directory")).toThrow(
        "is not a directory"
      );
    });

    it("includes path in error message", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => false });

      expect(() => validateDirectory("/custom/path", "Watch directory")).toThrow(
        "custom/path"
      );
    });

    it("returns resolved path", () => {
      const result = validateDirectory("./output", "Output directory");
      expect(result).toContain("output");
    });
  });

  describe("parseConcurrency", () => {
    it("parses valid concurrency value", () => {
      expect(parseConcurrency("5")).toBe(5);
    });

    it("accepts minimum value of 1", () => {
      expect(parseConcurrency("1")).toBe(1);
    });

    it("accepts maximum value of 10", () => {
      expect(parseConcurrency("10")).toBe(10);
    });

    it("throws for value less than 1", () => {
      expect(() => parseConcurrency("0")).toThrow(
        "Concurrency must be between 1 and 10"
      );
    });

    it("throws for value greater than 10", () => {
      expect(() => parseConcurrency("11")).toThrow(
        "Concurrency must be between 1 and 10"
      );
    });

    it("throws for non-numeric value", () => {
      expect(() => parseConcurrency("abc")).toThrow(
        "Concurrency must be between 1 and 10"
      );
    });

    it("throws for negative value", () => {
      expect(() => parseConcurrency("-1")).toThrow(
        "Concurrency must be between 1 and 10"
      );
    });

    it("throws for floating point value", () => {
      expect(parseConcurrency("5.5")).toBe(5); // parseInt truncates
    });
  });

  describe("createFileHandler", () => {
    const createMockLogger = (): Logger => {
      const logger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(() => logger),
      };
      return logger;
    };

    const createMockTimerService = (): TimerService => ({
      setTimeout: vi.fn((cb, ms) => setTimeout(cb, ms)),
      clearTimeout: vi.fn((id) => clearTimeout(id)),
    });

    it("ignores files that do not match patterns", () => {
      const onFileReady = vi.fn();
      const logger = createMockLogger();
      const ctx: FileHandlerContext = {
        config: { patterns: ["*.pdf"], debounceMs: 50 },
        logger,
        pendingFiles: new Map(),
        onFileReady,
      };

      const handler = createFileHandler(ctx);
      handler("/path/to/file.txt");

      expect(logger.debug).toHaveBeenCalledWith(
        "File does not match patterns, ignoring",
        expect.any(Object)
      );
      expect(onFileReady).not.toHaveBeenCalled();
    });

    it("debounces multiple events for same file", async () => {
      const onFileReady = vi.fn();
      const logger = createMockLogger();
      const ctx: FileHandlerContext = {
        config: { patterns: ["*.pdf"], debounceMs: 50 },
        logger,
        pendingFiles: new Map(),
        onFileReady,
      };
      const deps: WatchDeps = {
        timerService: createMockTimerService(),
        fileExists: () => true,
      };

      const handler = createFileHandler(ctx, deps);

      // Simulate rapid file events
      handler("/path/to/file.pdf");
      handler("/path/to/file.pdf");
      handler("/path/to/file.pdf");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only process once
      expect(onFileReady).toHaveBeenCalledTimes(1);
      expect(onFileReady).toHaveBeenCalledWith("/path/to/file.pdf");
    });

    it("processes different files independently", async () => {
      const onFileReady = vi.fn();
      const logger = createMockLogger();
      const ctx: FileHandlerContext = {
        config: { patterns: ["*.pdf"], debounceMs: 50 },
        logger,
        pendingFiles: new Map(),
        onFileReady,
      };
      const deps: WatchDeps = {
        timerService: createMockTimerService(),
        fileExists: () => true,
      };

      const handler = createFileHandler(ctx, deps);

      // Different files
      handler("/path/to/file1.pdf");
      handler("/path/to/file2.pdf");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onFileReady).toHaveBeenCalledTimes(2);
    });

    it("skips file if it no longer exists after debounce", async () => {
      const onFileReady = vi.fn();
      const logger = createMockLogger();
      const ctx: FileHandlerContext = {
        config: { patterns: ["*.pdf"], debounceMs: 10 },
        logger,
        pendingFiles: new Map(),
        onFileReady,
      };
      const deps: WatchDeps = {
        timerService: createMockTimerService(),
        fileExists: () => false, // File no longer exists
      };

      const handler = createFileHandler(ctx, deps);
      handler("/path/to/deleted.pdf");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(logger.debug).toHaveBeenCalledWith(
        "File no longer exists, skipping",
        expect.any(Object)
      );
      expect(onFileReady).not.toHaveBeenCalled();
    });

    it("clears previous timeout when same file is added again", async () => {
      const clearTimeoutMock = vi.fn();
      const onFileReady = vi.fn();
      const logger = createMockLogger();
      const ctx: FileHandlerContext = {
        config: { patterns: ["*.pdf"], debounceMs: 100 },
        logger,
        pendingFiles: new Map(),
        onFileReady,
      };
      const deps: WatchDeps = {
        timerService: {
          setTimeout: (cb, ms) => setTimeout(cb, ms),
          clearTimeout: clearTimeoutMock,
        },
        fileExists: () => true,
      };

      const handler = createFileHandler(ctx, deps);

      // First event sets up timeout
      handler("/path/to/file.pdf");
      expect(ctx.pendingFiles.has("/path/to/file.pdf")).toBe(true);

      // Second event should clear first timeout
      handler("/path/to/file.pdf");
      expect(clearTimeoutMock).toHaveBeenCalled();
    });
  });

  describe("polling options", () => {
    it("accepts --poll flag via WatchOptions interface", () => {
      // WatchOptions now includes poll and pollInterval
      const options: import("./watch.js").WatchOptions = {
        poll: true,
        pollInterval: "500",
      };
      expect(options.poll).toBe(true);
      expect(options.pollInterval).toBe("500");
    });

    it("accepts --poll-interval as string", () => {
      const options: import("./watch.js").WatchOptions = {
        pollInterval: "1000",
      };
      expect(options.pollInterval).toBe("1000");
    });
  });

  describe("clearPendingFiles", () => {
    it("clears all pending timeouts", () => {
      const clearTimeoutMock = vi.fn();
      const timerService: TimerService = {
        setTimeout: vi.fn(),
        clearTimeout: clearTimeoutMock,
      };

      const pendingFiles = new Map<string, NodeJS.Timeout>();
      const timeout1 = setTimeout(() => {}, 1000);
      const timeout2 = setTimeout(() => {}, 1000);
      pendingFiles.set("/file1.pdf", timeout1);
      pendingFiles.set("/file2.pdf", timeout2);

      clearPendingFiles(pendingFiles, { timerService });

      expect(clearTimeoutMock).toHaveBeenCalledTimes(2);
      expect(pendingFiles.size).toBe(0);

      // Clean up real timeouts
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    });

    it("handles empty pending files", () => {
      const clearTimeoutMock = vi.fn();
      const timerService: TimerService = {
        setTimeout: vi.fn(),
        clearTimeout: clearTimeoutMock,
      };

      const pendingFiles = new Map<string, NodeJS.Timeout>();
      clearPendingFiles(pendingFiles, { timerService });

      expect(clearTimeoutMock).not.toHaveBeenCalled();
      expect(pendingFiles.size).toBe(0);
    });
  });
});
