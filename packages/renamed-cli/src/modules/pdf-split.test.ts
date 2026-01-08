import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock ora before imports
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: ""
  })
}));

// Mock fs with configurable behavior
const mockStatSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockCreateWriteStream = vi.fn();
vi.mock("fs", () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args)
}));

// Mock node-fetch
const mockFetch = vi.fn();
vi.mock("node-fetch", () => ({
  default: (...args: unknown[]) => mockFetch(...args)
}));

import { splitPdf } from "./pdf-split.js";
import type { ApiClient } from "../lib/api-client.js";

describe("pdf-split module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default mock: valid file
    mockStatSync.mockReturnValue({
      isFile: () => true,
      size: 10 * 1024 * 1024 // 10MB
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("file validation", () => {
    it("throws error when file does not exist", async () => {
      mockStatSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(splitPdf(api, "/nonexistent.pdf", {})).rejects.toThrow(
        "Cannot access file: /nonexistent.pdf"
      );
    });

    it("throws error when path is not a file", async () => {
      mockStatSync.mockReturnValue({
        isFile: () => false,
        size: 0
      });

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(splitPdf(api, "/some/directory", {})).rejects.toThrow(
        "Not a file: /some/directory"
      );
    });

    it("throws error when file exceeds 100MB limit", async () => {
      mockStatSync.mockReturnValue({
        isFile: () => true,
        size: 150 * 1024 * 1024 // 150MB
      });

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(splitPdf(api, "/huge.pdf", {})).rejects.toThrow(
        /File exceeds 100MB limit/
      );
    });
  });

  describe("options validation", () => {
    it("throws error when every-n-pages mode without pagesPerSplit", async () => {
      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(
        splitPdf(api, "/test.pdf", { mode: "every-n-pages" })
      ).rejects.toThrow("--pages-per-split is required when using every-n-pages mode");
    });

    it("throws error when pagesPerSplit is not a positive integer", async () => {
      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(
        splitPdf(api, "/test.pdf", { mode: "every-n-pages", pagesPerSplit: "0" })
      ).rejects.toThrow("--pages-per-split must be a positive integer");

      await expect(
        splitPdf(api, "/test.pdf", { mode: "every-n-pages", pagesPerSplit: "-5" })
      ).rejects.toThrow("--pages-per-split must be a positive integer");

      await expect(
        splitPdf(api, "/test.pdf", { mode: "every-n-pages", pagesPerSplit: "abc" })
      ).rejects.toThrow("--pages-per-split must be a positive integer");
    });

    it("accepts valid pagesPerSplit value", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending"
        })
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", { mode: "every-n-pages", pagesPerSplit: "5" });

      expect(api.uploadFileWithFields).toHaveBeenCalled();
    });
  });

  describe("split modes", () => {
    it("uses smart mode by default", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending"
        })
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
          status: "pending"
        })
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", {
        mode: "smart",
        instructions: "Split by invoice number"
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/pdf-split",
        "/test.pdf",
        [
          { name: "mode", value: "smart" },
          { name: "instructions", value: "Split by invoice number" }
        ]
      );
    });

    it("sends correct fields for every-n-pages mode", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending"
        })
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", {
        mode: "every-n-pages",
        pagesPerSplit: "3"
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/pdf-split",
        "/test.pdf",
        [
          { name: "mode", value: "every-n-pages" },
          { name: "pagesPerSplit", value: 3 }
        ]
      );
    });

    it("sends correct fields for by-bookmarks mode", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending"
        })
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", { mode: "by-bookmarks" });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/pdf-split",
        "/test.pdf",
        [{ name: "mode", value: "by-bookmarks" }]
      );
    });
  });

  describe("job submission", () => {
    it("returns job response from API", async () => {
      const mockResponse = {
        jobId: "job-abc123",
        statusUrl: "/api/v1/pdf-split/status/job-abc123",
        status: "pending" as const
      };

      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue(mockResponse)
      } as unknown as ApiClient;

      const result = await splitPdf(api, "/document.pdf", {});

      expect(result).toEqual(mockResponse);
      expect(result.jobId).toBe("job-abc123");
    });

    it("propagates API errors", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockRejectedValue(new Error("Upload failed"))
      } as unknown as ApiClient;

      await expect(splitPdf(api, "/test.pdf", {})).rejects.toThrow("Upload failed");
    });
  });

  describe("combined options", () => {
    it("handles all options together", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({
          jobId: "job-123",
          statusUrl: "/status/job-123",
          status: "pending"
        })
      } as unknown as ApiClient;

      await splitPdf(api, "/test.pdf", {
        mode: "every-n-pages",
        pagesPerSplit: "2",
        instructions: "Name files by date",
        outputDir: "./output",
        wait: true
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/pdf-split",
        "/test.pdf",
        [
          { name: "mode", value: "every-n-pages" },
          { name: "instructions", value: "Name files by date" },
          { name: "pagesPerSplit", value: 2 }
        ]
      );
    });
  });
});
