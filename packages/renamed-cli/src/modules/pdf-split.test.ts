import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock ora before imports
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: "",
  }),
}));

// Mock fs with configurable behavior
const mockStatSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock("fs", () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  createWriteStream: vi.fn(),
}));

import {
  splitPdf,
  pollJobStatus,
  downloadSplitDocuments,
  formatJobInfo,
  formatPageInfo,
  formatCompletionSummary,
  validateFilePath,
  validateOptions,
  ensureOutputDir,
  type SplitDocument,
  type JobStatusResponse,
} from "./pdf-split.js";
import type { ApiClient } from "../lib/api-client.js";
import type { DownloadService } from "../lib/ports/download.js";

describe("pdf-split module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: valid file
    mockStatSync.mockReturnValue({
      isFile: () => true,
      size: 10 * 1024 * 1024, // 10MB
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validateFilePath", () => {
    it("throws error when file does not exist", () => {
      mockStatSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => validateFilePath("/nonexistent.pdf")).toThrow(
        "Cannot access file"
      );
    });

    it("throws error when path is not a file", () => {
      mockStatSync.mockReturnValue({
        isFile: () => false,
        size: 0,
      });

      expect(() => validateFilePath("/some/directory")).toThrow("Not a file");
    });

    it("throws error when file exceeds 100MB limit", () => {
      mockStatSync.mockReturnValue({
        isFile: () => true,
        size: 150 * 1024 * 1024, // 150MB
      });

      expect(() => validateFilePath("/huge.pdf")).toThrow(
        /File exceeds 100MB limit/
      );
    });

    it("does not throw for valid file", () => {
      expect(() => validateFilePath("/valid.pdf")).not.toThrow();
    });
  });

  describe("validateOptions", () => {
    it("throws error when every-n-pages mode without pagesPerSplit", () => {
      expect(() => validateOptions({ mode: "every-n-pages" })).toThrow(
        "--pages-per-split is required"
      );
    });

    it("throws error when pagesPerSplit is not a positive integer", () => {
      expect(() =>
        validateOptions({ mode: "every-n-pages", pagesPerSplit: "0" })
      ).toThrow("must be a positive integer");

      expect(() =>
        validateOptions({ mode: "every-n-pages", pagesPerSplit: "-5" })
      ).toThrow("must be a positive integer");

      expect(() =>
        validateOptions({ mode: "every-n-pages", pagesPerSplit: "abc" })
      ).toThrow("must be a positive integer");
    });

    it("accepts valid options", () => {
      expect(() => validateOptions({})).not.toThrow();
      expect(() => validateOptions({ mode: "smart" })).not.toThrow();
      expect(() =>
        validateOptions({ mode: "every-n-pages", pagesPerSplit: "5" })
      ).not.toThrow();
    });
  });

  describe("ensureOutputDir", () => {
    it("creates directory and returns resolved path", () => {
      const result = ensureOutputDir("./output");
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
      expect(result).toContain("output");
    });

    it("throws error on mkdir failure", () => {
      mockMkdirSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      expect(() => ensureOutputDir("/protected")).toThrow(
        "Failed to create output directory"
      );
    });
  });

  describe("splitPdf", () => {
    it("uses smart mode by default", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending",
        }),
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", {});

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/pdf-split",
        "/test.pdf",
        [{ name: "mode", value: "smart" }]
      );
    });

    it("sends correct fields for smart mode with instructions", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending",
        }),
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", {
        mode: "smart",
        instructions: "Split by invoice number",
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/pdf-split",
        "/test.pdf",
        [
          { name: "mode", value: "smart" },
          { name: "instructions", value: "Split by invoice number" },
        ]
      );
    });

    it("sends correct fields for every-n-pages mode", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending",
        }),
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", {
        mode: "every-n-pages",
        pagesPerSplit: "3",
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/pdf-split",
        "/test.pdf",
        [
          { name: "mode", value: "every-n-pages" },
          { name: "pagesPerSplit", value: 3 },
        ]
      );
    });

    it("propagates API errors", async () => {
      const api = {
        uploadFileWithFields: vi
          .fn()
          .mockRejectedValue(new Error("Upload failed")),
      } as unknown as ApiClient;

      await expect(splitPdf(api, "/test.pdf", {})).rejects.toThrow(
        "Upload failed"
      );
    });
  });

  describe("pollJobStatus", () => {
    const instantDelay = () => Promise.resolve();

    it("returns on completed status", async () => {
      const api = {
        get: vi.fn().mockResolvedValue({
          status: "completed",
          documents: [],
        }),
      } as unknown as ApiClient;

      const result = await pollJobStatus(api, "/status/123", {
        delay: instantDelay,
      });

      expect(result.status).toBe("completed");
    });

    it("throws on failed status", async () => {
      const api = {
        get: vi.fn().mockResolvedValue({
          status: "failed",
          error: "Processing error",
        }),
      } as unknown as ApiClient;

      await expect(
        pollJobStatus(api, "/status/123", { delay: instantDelay })
      ).rejects.toThrow("Processing error");
    });

    it("throws with default message on failed status without error", async () => {
      const api = {
        get: vi.fn().mockResolvedValue({
          status: "failed",
        }),
      } as unknown as ApiClient;

      await expect(
        pollJobStatus(api, "/status/123", { delay: instantDelay })
      ).rejects.toThrow("PDF split job failed");
    });

    it("polls until completed", async () => {
      const api = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ status: "pending" })
          .mockResolvedValueOnce({ status: "processing", progress: 50 })
          .mockResolvedValueOnce({ status: "completed", documents: [] }),
      } as unknown as ApiClient;

      const onProgress = vi.fn();
      const result = await pollJobStatus(
        api,
        "/status/123",
        { delay: instantDelay },
        onProgress
      );

      expect(result.status).toBe("completed");
      expect(api.get).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenCalledTimes(2);
    });

    it("calls onProgress with status updates", async () => {
      const api = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ jobId: "123", status: "pending" } as JobStatusResponse)
          .mockResolvedValueOnce({
            jobId: "123",
            status: "processing",
            progress: 50,
          } as JobStatusResponse)
          .mockResolvedValueOnce({
            jobId: "123",
            status: "completed",
            documents: [],
          } as JobStatusResponse),
      } as unknown as ApiClient;

      const onProgress = vi.fn();
      await pollJobStatus(api, "/status/123", { delay: instantDelay }, onProgress);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: "pending" })
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: "processing", progress: 50 })
      );
    });
  });

  describe("downloadSplitDocuments", () => {
    it("downloads all documents to output directory", async () => {
      const mockDownloadService: DownloadService = {
        download: vi.fn().mockResolvedValue(undefined),
      };

      const documents: SplitDocument[] = [
        { filename: "doc1.pdf", downloadUrl: "http://example.com/1", pages: [1] },
        {
          filename: "doc2.pdf",
          downloadUrl: "http://example.com/2",
          pages: [2, 3],
        },
      ];

      const result = await downloadSplitDocuments(
        documents,
        "/output",
        { downloadService: mockDownloadService }
      );

      expect(mockDownloadService.download).toHaveBeenCalledTimes(2);
      expect(mockDownloadService.download).toHaveBeenCalledWith(
        "http://example.com/1",
        "/output/doc1.pdf"
      );
      expect(mockDownloadService.download).toHaveBeenCalledWith(
        "http://example.com/2",
        "/output/doc2.pdf"
      );
      expect(result).toEqual(["/output/doc1.pdf", "/output/doc2.pdf"]);
    });

    it("calls onProgress for each document", async () => {
      const mockDownloadService: DownloadService = {
        download: vi.fn().mockResolvedValue(undefined),
      };

      const documents: SplitDocument[] = [
        { filename: "doc1.pdf", downloadUrl: "http://example.com/1", pages: [1] },
        { filename: "doc2.pdf", downloadUrl: "http://example.com/2", pages: [2] },
      ];

      const onProgress = vi.fn();
      await downloadSplitDocuments(
        documents,
        "/output",
        { downloadService: mockDownloadService },
        onProgress
      );

      expect(onProgress).toHaveBeenCalledWith(0, "doc1.pdf");
      expect(onProgress).toHaveBeenCalledWith(1, "doc2.pdf");
    });
  });

  describe("formatJobInfo", () => {
    it("formats job info correctly", () => {
      const result = formatJobInfo({
        jobId: "job-123",
        statusUrl: "/api/status/job-123",
        status: "pending",
      });

      expect(result).toContain("  Job ID: job-123");
      expect(result).toContain("  Status: pending");
      expect(result).toContain("  Status URL: /api/status/job-123");
      expect(result.some((line) => line.includes("--wait"))).toBe(true);
    });
  });

  describe("formatPageInfo", () => {
    it("formats single page correctly", () => {
      expect(formatPageInfo([1])).toBe("page 1");
    });

    it("formats multiple pages correctly", () => {
      expect(formatPageInfo([1, 2, 3])).toBe("pages 1, 2, 3");
    });
  });

  describe("formatCompletionSummary", () => {
    it("formats completion summary correctly", () => {
      const documents: SplitDocument[] = [
        { filename: "doc1.pdf", downloadUrl: "", pages: [1] },
        { filename: "doc2.pdf", downloadUrl: "", pages: [2, 3] },
      ];
      const paths = ["/output/doc1.pdf", "/output/doc2.pdf"];

      const result = formatCompletionSummary(documents, paths);

      expect(result).toContain("  Documents created: 2");
      expect(result.some((line) => line.includes("/output/doc1.pdf"))).toBe(
        true
      );
      expect(result.some((line) => line.includes("page 1"))).toBe(true);
      expect(result.some((line) => line.includes("pages 2, 3"))).toBe(true);
    });
  });
});
