import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock ora
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
vi.mock("fs", () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args)
}));

vi.mock("fs/promises", () => ({
  rename: vi.fn()
}));

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    red: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
    gray: (s: string) => s,
  }
}));

import { renameFiles } from "./rename.js";
import type { ApiClient } from "../lib/api-client.js";

describe("rename module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid file
    mockStatSync.mockReturnValue({
      isFile: () => true,
      size: 1024 * 1024 // 1MB
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs success message when file is renamed", async () => {
    const api = {
      uploadFile: vi.fn().mockResolvedValue({
        originalFilename: "messy_invoice.pdf",
        suggestedFilename: "2024-12-15_invoice_acme_corp.pdf"
      })
    } as unknown as ApiClient;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await renameFiles(api, ["./messy_invoice.pdf"], {});

    expect(api.uploadFile).toHaveBeenCalledWith("/rename", "./messy_invoice.pdf");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("messy_invoice.pdf → 2024-12-15_invoice_acme_corp.pdf")
    );
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
  });

  it("applies rename when --apply flag is used", async () => {
    const { rename } = await import("fs/promises");
    const renameMock = vi.mocked(rename);

    const api = {
      uploadFile: vi.fn().mockResolvedValue({
        originalFilename: "test.pdf",
        suggestedFilename: "renamed_test.pdf"
      })
    } as unknown as ApiClient;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await renameFiles(api, ["./test.pdf"], { apply: true });

    expect(renameMock).toHaveBeenCalledWith("./test.pdf", "renamed_test.pdf");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("✓ Moved to: renamed_test.pdf")
    );

    logSpy.mockRestore();
  });

  it("handles API errors gracefully", async () => {
    const api = {
      uploadFile: vi.fn().mockRejectedValue(new Error("API request failed"))
    } as unknown as ApiClient;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await renameFiles(api, ["./test.pdf"], {});

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error processing ./test.pdf: API request failed")
    );
    expect(process.exitCode).toBe(1);

    errorSpy.mockRestore();
  });

  describe("file validation", () => {
    it("skips file that is not a regular file", async () => {
      mockStatSync.mockReturnValue({
        isFile: () => false,
        size: 0
      });

      const api = { uploadFile: vi.fn() } as unknown as ApiClient;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await renameFiles(api, ["./directory"], {});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("is not a file")
      );
      expect(api.uploadFile).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it("skips file that exceeds size limit", async () => {
      mockStatSync.mockReturnValue({
        isFile: () => true,
        size: 30 * 1024 * 1024 // 30MB
      });

      const api = { uploadFile: vi.fn() } as unknown as ApiClient;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await renameFiles(api, ["./large.pdf"], {});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("exceeds 25MB limit")
      );
      expect(api.uploadFile).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it("skips file that cannot be accessed", async () => {
      mockStatSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const api = { uploadFile: vi.fn() } as unknown as ApiClient;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await renameFiles(api, ["./missing.pdf"], {});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot access file")
      );
      expect(api.uploadFile).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });

  describe("output directory options", () => {
    it("moves file to output dir with folder structure", async () => {
      const { rename } = await import("fs/promises");
      const renameMock = vi.mocked(rename);

      const api = {
        uploadFile: vi.fn(async () => ({
          originalFilename: "invoice.pdf",
          suggestedFilename: "2024_invoice.pdf",
          suggestedFolderPath: "Invoices/2024"
        }))
      } as unknown as ApiClient;

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await renameFiles(api, ["./invoice.pdf"], {
        apply: true,
        outputDir: "/output"
      });

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("Invoices/2024"),
        { recursive: true }
      );
      expect(renameMock).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("/output/Invoices/2024/2024_invoice.pdf")
      );

      logSpy.mockRestore();
    });

    it("moves file to output dir without folder structure", async () => {
      const { rename } = await import("fs/promises");
      const renameMock = vi.mocked(rename);

      const api = {
        uploadFile: vi.fn(async () => ({
          originalFilename: "invoice.pdf",
          suggestedFilename: "2024_invoice.pdf"
          // No suggestedFolderPath
        }))
      } as unknown as ApiClient;

      await renameFiles(api, ["./invoice.pdf"], {
        apply: true,
        outputDir: "/output"
      });

      expect(mockMkdirSync).toHaveBeenCalledWith("/output", { recursive: true });
      expect(renameMock).toHaveBeenCalled();
    });

    it("displays folder path in suggestion", async () => {
      const api = {
        uploadFile: vi.fn(async () => ({
          originalFilename: "invoice.pdf",
          suggestedFilename: "2024_invoice.pdf",
          suggestedFolderPath: "Invoices/2024"
        }))
      } as unknown as ApiClient;

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await renameFiles(api, ["./invoice.pdf"], {});

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invoices/2024/2024_invoice.pdf")
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Folder: Invoices/2024")
      );

      logSpy.mockRestore();
    });
  });

  describe("multiple files", () => {
    it("processes multiple files", async () => {
      const api = {
        uploadFile: vi.fn()
          .mockResolvedValueOnce({
            originalFilename: "file1.pdf",
            suggestedFilename: "renamed1.pdf"
          })
          .mockResolvedValueOnce({
            originalFilename: "file2.pdf",
            suggestedFilename: "renamed2.pdf"
          })
      } as unknown as ApiClient;

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await renameFiles(api, ["./file1.pdf", "./file2.pdf"], {});

      expect(api.uploadFile).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("file1.pdf → renamed1.pdf")
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("file2.pdf → renamed2.pdf")
      );

      logSpy.mockRestore();
    });

    it("continues processing after individual file error", async () => {
      // First file fails validation, second succeeds
      mockStatSync
        .mockImplementationOnce(() => { throw new Error("ENOENT"); })
        .mockReturnValueOnce({ isFile: () => true, size: 1024 });

      const api = {
        uploadFile: vi.fn(async () => ({
          originalFilename: "file2.pdf",
          suggestedFilename: "renamed2.pdf"
        }))
      } as unknown as ApiClient;

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await renameFiles(api, ["./missing.pdf", "./file2.pdf"], {});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot access file")
      );
      expect(api.uploadFile).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("file2.pdf → renamed2.pdf")
      );

      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });
});
