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
const mockReadFileSync = vi.fn();
vi.mock("fs", () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args)
}));

import { extractFromFile, type ExtractOptions } from "./extract.js";
import type { ApiClient } from "../lib/api-client.js";

describe("extract module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: valid file
    mockStatSync.mockReturnValue({
      isFile: () => true,
      size: 1024 * 1024 // 1MB
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("file validation", () => {
    it("throws error when file does not exist", async () => {
      mockStatSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(extractFromFile(api, "/nonexistent.pdf", {})).rejects.toThrow(
        "Cannot access file: /nonexistent.pdf"
      );
    });

    it("throws error when path is not a file", async () => {
      mockStatSync.mockReturnValue({
        isFile: () => false,
        size: 0
      });

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(extractFromFile(api, "/some/directory", {})).rejects.toThrow(
        "Not a file: /some/directory"
      );
    });

    it("throws error when file exceeds 25MB limit", async () => {
      mockStatSync.mockReturnValue({
        isFile: () => true,
        size: 30 * 1024 * 1024 // 30MB
      });

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(extractFromFile(api, "/large.pdf", {})).rejects.toThrow(
        /File exceeds 25MB limit/
      );
    });
  });

  describe("schema parsing", () => {
    it("parses valid inline JSON schema", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({ fields: [] })
      } as unknown as ApiClient;

      const schema = JSON.stringify({
        fields: [{ name: "total", type: "currency" }]
      });

      await extractFromFile(api, "/test.pdf", { schema });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/extract",
        "/test.pdf",
        [{ name: "schema", value: schema }]
      );
    });

    it("throws error for invalid JSON schema", async () => {
      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(
        extractFromFile(api, "/test.pdf", { schema: "not valid json" })
      ).rejects.toThrow("Invalid JSON in --schema option");
    });

    it("parses schema from file", async () => {
      const schemaContent = JSON.stringify({
        fields: [{ name: "invoice_number", type: "string" }]
      });
      mockReadFileSync.mockReturnValue(schemaContent);

      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({ fields: [] })
      } as unknown as ApiClient;

      await extractFromFile(api, "/test.pdf", { schemaFile: "/schema.json" });

      expect(mockReadFileSync).toHaveBeenCalledWith("/schema.json", "utf-8");
      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/extract",
        "/test.pdf",
        [{ name: "schema", value: schemaContent }]
      );
    });

    it("throws error when schema file not found", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockReadFileSync.mockImplementation(() => {
        throw error;
      });

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(
        extractFromFile(api, "/test.pdf", { schemaFile: "/missing.json" })
      ).rejects.toThrow("Schema file not found: /missing.json");
    });

    it("throws error when schema file contains invalid JSON", async () => {
      mockReadFileSync.mockReturnValue("{ invalid json }");

      const api = { uploadFileWithFields: vi.fn() } as unknown as ApiClient;

      await expect(
        extractFromFile(api, "/test.pdf", { schemaFile: "/invalid.json" })
      ).rejects.toThrow(/Failed to parse schema file/);
    });

    it("parser ID takes precedence over schema", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({ fields: [] })
      } as unknown as ApiClient;

      await extractFromFile(api, "/test.pdf", {
        parserId: "parser-123",
        schema: '{"fields":[]}' // This should be ignored
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/extract",
        "/test.pdf",
        [{ name: "parserId", value: "parser-123" }]
      );
    });

    it("uses discovery mode when no schema provided", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({ fields: [] })
      } as unknown as ApiClient;

      await extractFromFile(api, "/test.pdf", {});

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/extract",
        "/test.pdf",
        [] // No schema fields
      );
    });
  });

  describe("instructions handling", () => {
    it("includes instructions in request", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({ fields: [] })
      } as unknown as ApiClient;

      await extractFromFile(api, "/test.pdf", {
        instructions: "Focus on line items"
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/extract",
        "/test.pdf",
        [{ name: "instructions", value: "Focus on line items" }]
      );
    });

    it("combines schema and instructions", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue({ fields: [] })
      } as unknown as ApiClient;

      const schema = JSON.stringify({ fields: [{ name: "total", type: "currency" }] });

      await extractFromFile(api, "/test.pdf", {
        schema,
        instructions: "German invoice format"
      });

      expect(api.uploadFileWithFields).toHaveBeenCalledWith(
        "/extract",
        "/test.pdf",
        [
          { name: "schema", value: schema },
          { name: "instructions", value: "German invoice format" }
        ]
      );
    });
  });

  describe("API response handling", () => {
    it("returns extracted fields from API", async () => {
      const mockResponse = {
        fields: [
          { name: "invoice_number", value: "INV-001", confidence: 0.95 },
          { name: "total", value: 150.0, confidence: 0.87 }
        ],
        metadata: { pageCount: 2, processingTimeMs: 1234 }
      };

      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue(mockResponse)
      } as unknown as ApiClient;

      const result = await extractFromFile(api, "/invoice.pdf", {});

      expect(result).toEqual(mockResponse);
      expect(result.fields).toHaveLength(2);
      expect(result.fields![0].confidence).toBe(0.95);
    });

    it("returns extracted tables from API", async () => {
      const mockResponse = {
        tables: [
          {
            name: "line_items",
            rows: [
              { description: "Widget A", quantity: 5, price: 10.0 },
              { description: "Widget B", quantity: 3, price: 15.0 }
            ]
          }
        ]
      };

      const api = {
        uploadFileWithFields: vi.fn().mockResolvedValue(mockResponse)
      } as unknown as ApiClient;

      const result = await extractFromFile(api, "/invoice.pdf", {});

      expect(result.tables).toHaveLength(1);
      expect(result.tables![0].rows).toHaveLength(2);
    });

    it("propagates API errors", async () => {
      const api = {
        uploadFileWithFields: vi.fn().mockRejectedValue(new Error("API rate limited"))
      } as unknown as ApiClient;

      await expect(extractFromFile(api, "/test.pdf", {})).rejects.toThrow(
        "API rate limited"
      );
    });
  });
});
