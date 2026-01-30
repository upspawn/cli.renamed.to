import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateFile, processFile } from "./file-processor.js";
import type { ApiClient } from "./api-client.js";

// Mock fs module
vi.mock("fs", () => ({
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  rename: vi.fn(),
}));

import { statSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
import { rename as renameFile } from "fs/promises";

describe("file-processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateFile", () => {
    it("throws if file does not exist", () => {
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => validateFile("/path/to/missing.pdf")).toThrow(
        "Cannot access file"
      );
    });

    it("throws if path is not a file", () => {
      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        size: 1024,
      } as ReturnType<typeof statSync>);

      expect(() => validateFile("/path/to/directory")).toThrow("Not a file");
    });

    it("throws if file exceeds size limit", () => {
      const sizeBytes = 30 * 1024 * 1024; // 30MB
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        size: sizeBytes,
      } as ReturnType<typeof statSync>);

      expect(() => validateFile("/path/to/large.pdf")).toThrow(
        "exceeds 25MB limit"
      );
    });

    it("does not throw for valid file within size limit", () => {
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        size: 1024 * 1024, // 1MB
      } as ReturnType<typeof statSync>);

      expect(() => validateFile("/path/to/valid.pdf")).not.toThrow();
    });
  });

  describe("processFile", () => {
    const createMockApi = (response: unknown) =>
      ({
        uploadFile: vi.fn().mockResolvedValue(response),
      }) as unknown as ApiClient;

    const validFileStats = {
      isFile: () => true,
      size: 1024,
    };

    beforeEach(() => {
      vi.mocked(statSync).mockReturnValue(validFileStats as ReturnType<typeof statSync>);
      vi.mocked(renameFile).mockResolvedValue(undefined);
    });

    it("returns success with suggested filename", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "2024-01-15_Invoice_Acme.pdf",
        suggestedFolderPath: "Invoices/2024",
      });

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: false,
      });

      expect(result.success).toBe(true);
      expect(result.suggestedFilename).toBe("2024-01-15_Invoice_Acme.pdf");
      expect(result.suggestedFolderPath).toBe("Invoices/2024");
    });

    it("moves file when apply is true with outputDir", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "2024-01-15_Invoice_Acme.pdf",
        suggestedFolderPath: "Invoices/2024",
      });

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
        outputDir: "/output",
      });

      expect(result.success).toBe(true);
      expect(result.destinationPath).toBe(
        "/output/Invoices/2024/2024-01-15_Invoice_Acme.pdf"
      );
      expect(renameFile).toHaveBeenCalled();
    });

    it("renames file in place when apply is true without outputDir", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "renamed.pdf",
      });

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
      });

      expect(result.success).toBe(true);
      expect(result.destinationPath).toBe("/path/to/renamed.pdf");
    });

    it("does not move file in dry run mode", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "renamed.pdf",
      });

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
        outputDir: "/output",
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(renameFile).not.toHaveBeenCalled();
    });

    it("handles cross-device move with copy+delete", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "renamed.pdf",
      });

      const crossDeviceError = new Error("Cross-device link") as NodeJS.ErrnoException;
      crossDeviceError.code = "EXDEV";
      vi.mocked(renameFile).mockRejectedValue(crossDeviceError);

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
        outputDir: "/output",
      });

      expect(result.success).toBe(true);
      expect(copyFileSync).toHaveBeenCalled();
      expect(unlinkSync).toHaveBeenCalled();
    });

    it("returns error result on API failure", async () => {
      const api = {
        uploadFile: vi.fn().mockRejectedValue(new Error("API error")),
      } as unknown as ApiClient;

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("API error");
    });

    it("moves file to failed directory on error when specified", async () => {
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        size: 1024,
      } as ReturnType<typeof statSync>);

      const api = {
        uploadFile: vi.fn().mockRejectedValue(new Error("Processing failed")),
      } as unknown as ApiClient;

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
        failedDir: "/failed",
      });

      expect(result.success).toBe(false);
      expect(copyFileSync).toHaveBeenCalled();
      expect(unlinkSync).toHaveBeenCalled();
    });

    it("does not move to failed dir in dry run mode", async () => {
      const api = {
        uploadFile: vi.fn().mockRejectedValue(new Error("Processing failed")),
      } as unknown as ApiClient;

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
        failedDir: "/failed",
        dryRun: true,
      });

      expect(result.success).toBe(false);
      expect(copyFileSync).not.toHaveBeenCalled();
    });

    it("handles validation errors before API call", async () => {
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const api = createMockApi({});

      const result = await processFile(api, "/path/to/missing.pdf", {
        apply: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot access file");
      expect(api.uploadFile).not.toHaveBeenCalled();
    });

    it("creates target directory when needed", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "renamed.pdf",
        suggestedFolderPath: "deep/nested/path",
      });

      await processFile(api, "/path/to/document.pdf", {
        apply: true,
        outputDir: "/output",
      });

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("deep/nested/path"),
        { recursive: true }
      );
    });

    it("handles empty suggestedFolderPath", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "renamed.pdf",
        suggestedFolderPath: undefined,
      });

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
        outputDir: "/output",
      });

      expect(result.destinationPath).toBe("/output/renamed.pdf");
    });

    it("uses logger when provided", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "renamed.pdf",
      });

      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      await processFile(
        api,
        "/path/to/document.pdf",
        { apply: true, outputDir: "/output" },
        mockLogger as unknown as Parameters<typeof processFile>[3]
      );

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("re-throws non-EXDEV errors during move", async () => {
      const api = createMockApi({
        originalFilename: "document.pdf",
        suggestedFilename: "renamed.pdf",
      });

      const permissionError = new Error("Permission denied") as NodeJS.ErrnoException;
      permissionError.code = "EACCES";
      vi.mocked(renameFile).mockRejectedValue(permissionError);

      const result = await processFile(api, "/path/to/document.pdf", {
        apply: true,
        outputDir: "/output",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission denied");
    });
  });

});

