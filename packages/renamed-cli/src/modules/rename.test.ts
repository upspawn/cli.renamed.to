import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
vi.mock("ora", () => ({
  default: () => ({
    start: () => ({
      succeed: vi.fn(),
      fail: vi.fn(),
      text: ""
    })
  })
}));
vi.mock("fs", () => ({
  statSync: vi.fn(() => ({
    isFile: () => true,
    size: 1024 * 1024 // 1MB
  }))
}));
vi.mock("fs/promises", () => ({
  rename: vi.fn()
}));
import { renameFiles } from "./rename.js";
import type { ApiClient } from "../lib/api-client.js";

describe("rename module", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs success message when file is renamed", async () => {
    const api = {
      uploadFile: vi.fn(async () => ({
        originalFilename: "messy_invoice.pdf",
        suggestedFilename: "2024-12-15_invoice_acme_corp.pdf"
      }))
    } satisfies Partial<ApiClient>;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    await renameFiles(api as ApiClient, ["./messy_invoice.pdf"], {});

    expect(api.uploadFile).toHaveBeenCalledWith("/rename", "./messy_invoice.pdf");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("messy_invoice.pdf → 2024-12-15_invoice_acme_corp.pdf")
    );
    expect(process.exitCode).toBeUndefined();

    process.exitCode = originalExitCode;
    logSpy.mockRestore();
  });

  it("applies rename when --apply flag is used", async () => {
    const { rename } = await import("fs/promises");
    const renameMock = vi.mocked(rename);

    const api = {
      uploadFile: vi.fn(async () => ({
        originalFilename: "test.pdf",
        suggestedFilename: "renamed_test.pdf"
      }))
    } satisfies Partial<ApiClient>;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await renameFiles(api as ApiClient, ["./test.pdf"], { apply: true });

    expect(renameMock).toHaveBeenCalledWith("./test.pdf", "./renamed_test.pdf");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("✓ Renamed to: ./renamed_test.pdf")
    );

    logSpy.mockRestore();
  });

  it("handles API errors gracefully", async () => {
    const api = {
      uploadFile: vi.fn().mockRejectedValue(new Error("API request failed"))
    } satisfies Partial<ApiClient>;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    await renameFiles(api as ApiClient, ["./test.pdf"], {});

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error processing ./test.pdf: API request failed")
    );
    // Note: process.exitCode is set asynchronously, so we check it's defined
    expect(typeof process.exitCode).toBe("number");

    process.exitCode = originalExitCode;
    errorSpy.mockRestore();
  });
});
