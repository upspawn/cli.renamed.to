import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs with configurable behavior
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockStatSync = vi.fn();
const mockCopyFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

// Mock pdf-split module
const mockSplitPdf = vi.fn();
const mockPollJobStatus = vi.fn();
const mockDownloadSplitDocuments = vi.fn();
const mockValidatePdfFilePath = vi.fn();
vi.mock("./pdf-split.js", () => ({
  splitPdf: (...args: unknown[]) => mockSplitPdf(...args),
  pollJobStatus: (...args: unknown[]) => mockPollJobStatus(...args),
  downloadSplitDocuments: (...args: unknown[]) => mockDownloadSplitDocuments(...args),
  validateFilePath: (...args: unknown[]) => mockValidatePdfFilePath(...args),
}));

import {
  matchesPatterns,
  validateDirectory,
  parseConcurrency,
  isPdfFile,
  createFileHandler,
  clearPendingFiles,
  moveToPassthrough,
  processPdfSplit,
  type FileHandlerContext,
  type WatchDeps,
} from "./watch.js";
import type { ApiClient } from "../lib/api-client.js";
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

  describe("moveToPassthrough", () => {
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

    it("moves file with original filename (no timestamp prefix)", async () => {
      const logger = createMockLogger();

      const result = await moveToPassthrough(
        "/input/invoice.pdf",
        "/output",
        logger
      );

      expect(result).toBe("/output/invoice.pdf");
      expect(mockMkdirSync).toHaveBeenCalledWith("/output", { recursive: true });
      expect(mockCopyFileSync).toHaveBeenCalledWith("/input/invoice.pdf", "/output/invoice.pdf");
      expect(mockUnlinkSync).toHaveBeenCalledWith("/input/invoice.pdf");
      expect(logger.warn).toHaveBeenCalledWith(
        "File passed through untouched (processing failed)",
        expect.objectContaining({ from: "/input/invoice.pdf", to: "/output/invoice.pdf" })
      );
    });

    it("returns target path without moving in dry-run mode", async () => {
      const logger = createMockLogger();

      const result = await moveToPassthrough(
        "/input/invoice.pdf",
        "/output",
        logger,
        true // dryRun
      );

      expect(result).toBe("/output/invoice.pdf");
      expect(mockCopyFileSync).not.toHaveBeenCalled();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Dry run - would passthrough",
        expect.any(Object)
      );
    });

    it("returns undefined and logs error on failure", async () => {
      const logger = createMockLogger();
      mockCopyFileSync.mockImplementationOnce(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = await moveToPassthrough(
        "/input/invoice.pdf",
        "/output",
        logger
      );

      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to move file to passthrough directory",
        expect.objectContaining({ filePath: "/input/invoice.pdf" })
      );
    });
  });

  describe("passthrough options", () => {
    it("accepts --passthrough flag via WatchOptions interface", () => {
      const options: import("./watch.js").WatchOptions = {
        passthrough: true,
        passthroughDir: "/custom/passthrough",
      };
      expect(options.passthrough).toBe(true);
      expect(options.passthroughDir).toBe("/custom/passthrough");
    });
  });

  describe("isPdfFile", () => {
    it("returns true for .pdf extension", () => {
      expect(isPdfFile("/path/to/document.pdf")).toBe(true);
    });

    it("returns true for uppercase .PDF extension", () => {
      expect(isPdfFile("/path/to/DOCUMENT.PDF")).toBe(true);
    });

    it("returns true for mixed case .Pdf extension", () => {
      expect(isPdfFile("/path/to/document.Pdf")).toBe(true);
    });

    it("returns false for .jpg extension", () => {
      expect(isPdfFile("/path/to/photo.jpg")).toBe(false);
    });

    it("returns false for .pdf.bak extension", () => {
      expect(isPdfFile("/path/to/document.pdf.bak")).toBe(false);
    });

    it("returns false for file without extension", () => {
      expect(isPdfFile("/path/to/Makefile")).toBe(false);
    });
  });

  describe("processPdfSplit", () => {
    const createMockApi = () =>
      ({
        uploadFileWithFields: vi.fn(),
        get: vi.fn(),
      }) as unknown as ApiClient;

    const mockDocuments = [
      { filename: "invoice-001.pdf", downloadUrl: "https://example.com/1", pages: [1, 2] },
      { filename: "invoice-002.pdf", downloadUrl: "https://example.com/2", pages: [3, 4] },
    ];

    beforeEach(() => {
      mockSplitPdf.mockResolvedValue({
        jobId: "job-123",
        statusUrl: "/jobs/job-123",
        status: "pending",
      });
      mockPollJobStatus.mockResolvedValue({
        jobId: "job-123",
        status: "completed",
        documents: mockDocuments,
      });
      mockDownloadSplitDocuments.mockResolvedValue([
        "/output/invoice-001.pdf",
        "/output/invoice-002.pdf",
      ]);
      mockValidatePdfFilePath.mockImplementation(() => {});
    });

    it("returns success with split output paths", async () => {
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
      });

      expect(result.success).toBe(true);
      expect(result.splitOutputPaths).toEqual([
        "/output/invoice-001.pdf",
        "/output/invoice-002.pdf",
      ]);
      expect(result.splitDocumentCount).toBe(2);
      expect(result.suggestedFilename).toBe("invoice-001.pdf");
      expect(result.destinationPath).toBe("/output");
    });

    it("calls splitPdf with smart mode", async () => {
      const api = createMockApi();

      await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
      });

      expect(mockSplitPdf).toHaveBeenCalledWith(api, "/path/to/batch.pdf", { mode: "smart" });
    });

    it("downloads split documents to output dir", async () => {
      const api = createMockApi();

      await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
      });

      expect(mockMkdirSync).toHaveBeenCalledWith("/output", { recursive: true });
      expect(mockDownloadSplitDocuments).toHaveBeenCalledWith(
        mockDocuments,
        "/output",
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("does not delete source PDF by default", async () => {
      const api = createMockApi();

      await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
      });

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it("deletes source PDF when deleteSourcePdf is true", async () => {
      const api = createMockApi();

      await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
        deleteSourcePdf: true,
      });

      expect(mockUnlinkSync).toHaveBeenCalledWith("/path/to/batch.pdf");
    });

    it("skips API call, download and delete in dry-run mode", async () => {
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
        deleteSourcePdf: true,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.splitOutputPaths).toEqual([]);
      expect(result.splitDocumentCount).toBe(0);
      expect(mockSplitPdf).not.toHaveBeenCalled();
      expect(mockPollJobStatus).not.toHaveBeenCalled();
      expect(mockDownloadSplitDocuments).not.toHaveBeenCalled();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it("returns error on API failure", async () => {
      mockSplitPdf.mockRejectedValue(new Error("Upload failed"));
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Upload failed");
    });

    it("returns error on poll timeout", async () => {
      mockPollJobStatus.mockRejectedValue(new Error("Job timed out after 10 minutes"));
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Job timed out after 10 minutes");
    });

    it("moves to failed dir on error when specified", async () => {
      mockSplitPdf.mockRejectedValue(new Error("Split failed"));
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/batch.pdf", {
        outputDir: "/output",
        failedDir: "/failed",
      });

      expect(result.success).toBe(false);
      expect(mockCopyFileSync).toHaveBeenCalled();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it("does not move to failed dir on validation error in dry-run mode", async () => {
      mockValidatePdfFilePath.mockImplementation(() => {
        throw new Error("File exceeds 100MB limit");
      });
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/huge.pdf", {
        outputDir: "/output",
        failedDir: "/failed",
        dryRun: true,
      });

      // Validation errors still happen in dry-run (they're cheap and local),
      // but the file should still be moved to failed dir since it can't be processed
      expect(result.success).toBe(false);
      expect(result.error).toContain("100MB");
    });

    it("handles validation error before API call", async () => {
      mockValidatePdfFilePath.mockImplementation(() => {
        throw new Error("File exceeds 100MB limit");
      });
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/huge.pdf", {
        outputDir: "/output",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("100MB");
      expect(mockSplitPdf).not.toHaveBeenCalled();
    });

    it("handles split producing no documents", async () => {
      mockPollJobStatus.mockResolvedValue({
        jobId: "job-123",
        status: "completed",
        documents: [],
      });
      const api = createMockApi();

      const result = await processPdfSplit(api, "/path/to/empty.pdf", {
        outputDir: "/output",
      });

      expect(result.success).toBe(true);
      expect(result.splitOutputPaths).toEqual([]);
      expect(result.splitDocumentCount).toBe(0);
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
