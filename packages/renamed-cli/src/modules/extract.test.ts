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

import {
  extractFromFile,
  formatValue,
  formatConfidence,
  buildFieldRow,
  buildFieldRows,
  buildTableData,
  formatMetadata,
  parseInlineSchema,
  parseSchemaContent,
  validateFilePath,
  type ExtractedField,
  type ExtractedTable,
} from "./extract.js";
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

    it("throws error when file exceeds 25MB limit", () => {
      mockStatSync.mockReturnValue({
        isFile: () => true,
        size: 30 * 1024 * 1024,
      });

      expect(() => validateFilePath("/large.pdf")).toThrow(
        /File exceeds 25MB limit/
      );
    });

    it("does not throw for valid file", () => {
      expect(() => validateFilePath("/valid.pdf")).not.toThrow();
    });
  });

  describe("parseInlineSchema", () => {
    it("parses valid JSON schema", () => {
      const schema = parseInlineSchema('{"fields": [{"name": "total", "type": "currency"}]}');
      expect(schema.fields).toHaveLength(1);
      expect(schema.fields![0].name).toBe("total");
    });

    it("throws error for invalid JSON", () => {
      expect(() => parseInlineSchema("not valid json")).toThrow(
        "Invalid JSON in --schema option"
      );
    });
  });

  describe("parseSchemaContent", () => {
    it("parses valid JSON content", () => {
      const schema = parseSchemaContent('{"tables": []}', "/schema.json");
      expect(schema.tables).toEqual([]);
    });

    it("throws error for invalid JSON content", () => {
      expect(() => parseSchemaContent("{ invalid }", "/schema.json")).toThrow(
        /Failed to parse schema file/
      );
    });
  });

  describe("formatValue", () => {
    it("returns '(empty)' for null", () => {
      expect(formatValue(null)).toBe("(empty)");
    });

    it("returns '(empty)' for undefined", () => {
      expect(formatValue(undefined)).toBe("(empty)");
    });

    it("returns JSON string for objects", () => {
      expect(formatValue({ key: "value" })).toBe('{"key":"value"}');
    });

    it("returns JSON string for arrays", () => {
      expect(formatValue([1, 2, 3])).toBe("[1,2,3]");
    });

    it("returns string for numbers", () => {
      expect(formatValue(42)).toBe("42");
    });

    it("returns string for strings", () => {
      expect(formatValue("hello")).toBe("hello");
    });

    it("returns string for booleans", () => {
      expect(formatValue(true)).toBe("true");
    });
  });

  describe("formatConfidence", () => {
    it("formats confidence as percentage", () => {
      expect(formatConfidence(0.95)).toBe("95%");
    });

    it("rounds to nearest integer", () => {
      expect(formatConfidence(0.876)).toBe("88%");
    });

    it("returns '-' for undefined confidence", () => {
      expect(formatConfidence(undefined)).toBe("-");
    });

    it("handles 100% confidence", () => {
      expect(formatConfidence(1.0)).toBe("100%");
    });

    it("handles 0% confidence", () => {
      expect(formatConfidence(0)).toBe("0%");
    });
  });

  describe("buildFieldRow", () => {
    it("builds row data from field with confidence", () => {
      const field: ExtractedField = {
        name: "total",
        value: 150.0,
        confidence: 0.95,
      };

      const row = buildFieldRow(field);

      expect(row.name).toBe("total");
      expect(row.value).toBe("150");
      expect(row.confidence).toBe("95%");
    });

    it("builds row data from field without confidence", () => {
      const field: ExtractedField = {
        name: "invoice_number",
        value: "INV-001",
      };

      const row = buildFieldRow(field);

      expect(row.name).toBe("invoice_number");
      expect(row.value).toBe("INV-001");
      expect(row.confidence).toBe("-");
    });

    it("handles null values", () => {
      const field: ExtractedField = {
        name: "optional_field",
        value: null,
      };

      const row = buildFieldRow(field);

      expect(row.value).toBe("(empty)");
    });
  });

  describe("buildFieldRows", () => {
    it("builds rows for multiple fields", () => {
      const fields: ExtractedField[] = [
        { name: "field1", value: "value1", confidence: 0.9 },
        { name: "field2", value: "value2", confidence: 0.8 },
      ];

      const rows = buildFieldRows(fields);

      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe("field1");
      expect(rows[1].name).toBe("field2");
    });

    it("returns empty array for empty input", () => {
      expect(buildFieldRows([])).toEqual([]);
    });
  });

  describe("buildTableData", () => {
    it("builds table data from extracted table", () => {
      const table: ExtractedTable = {
        name: "line_items",
        rows: [
          { description: "Widget A", quantity: 5, price: 10.0 },
          { description: "Widget B", quantity: 3, price: 15.0 },
        ],
      };

      const data = buildTableData(table);

      expect(data.name).toBe("line_items");
      expect(data.columns).toEqual(["description", "quantity", "price"]);
      expect(data.rows).toHaveLength(2);
      expect(data.rows[0]).toEqual(["Widget A", "5", "10"]);
      expect(data.rows[1]).toEqual(["Widget B", "3", "15"]);
    });

    it("returns empty columns and rows for empty table", () => {
      const table: ExtractedTable = {
        name: "empty_table",
        rows: [],
      };

      const data = buildTableData(table);

      expect(data.name).toBe("empty_table");
      expect(data.columns).toEqual([]);
      expect(data.rows).toEqual([]);
    });

    it("handles null values in table cells", () => {
      const table: ExtractedTable = {
        name: "partial_data",
        rows: [{ col1: "value", col2: null }],
      };

      const data = buildTableData(table);

      expect(data.rows[0]).toEqual(["value", "(empty)"]);
    });
  });

  describe("formatMetadata", () => {
    it("formats metadata with page count and processing time", () => {
      const lines = formatMetadata({
        pageCount: 5,
        processingTimeMs: 1234,
      });

      expect(lines).toContain("Pages: 5");
      expect(lines).toContain("Processing time: 1234ms");
    });

    it("shows 'unknown' for missing page count", () => {
      const lines = formatMetadata({
        processingTimeMs: 500,
      });

      expect(lines).toContain("Pages: unknown");
    });

    it("omits processing time if not provided", () => {
      const lines = formatMetadata({
        pageCount: 3,
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe("Pages: 3");
    });

    it("returns empty array for undefined metadata", () => {
      expect(formatMetadata(undefined)).toEqual([]);
    });
  });
});
