import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveConfig,
  loadConfigFile,
  ConfigFileSchema,
  CONFIG_DEFAULTS,
} from "./config.js";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from "fs";

describe("config", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("resolveConfig", () => {
    it("returns defaults when no config provided", () => {
      const config = resolveConfig();

      expect(config.concurrency).toBe(CONFIG_DEFAULTS.concurrency);
      expect(config.debounceMs).toBe(CONFIG_DEFAULTS.debounceMs);
      expect(config.retryAttempts).toBe(CONFIG_DEFAULTS.retryAttempts);
      expect(config.retryDelayMs).toBe(CONFIG_DEFAULTS.retryDelayMs);
      expect(config.patterns).toEqual(expect.arrayContaining(["*.pdf"]));
      expect(config.logLevel).toBe("info");
      expect(config.logJson).toBe(false);
      expect(config.healthEnabled).toBe(true);
    });

    it("user config overrides system config", () => {
      const systemConfig = { rateLimit: { concurrency: 3 } };
      const userConfig = { rateLimit: { concurrency: 5 } };

      const config = resolveConfig({}, userConfig, systemConfig);

      expect(config.concurrency).toBe(5);
    });

    it("CLI options override all configs", () => {
      const userConfig = { rateLimit: { concurrency: 5 } };

      const config = resolveConfig({ concurrency: 1 }, userConfig);

      expect(config.concurrency).toBe(1);
    });

    it("preserves other defaults when overriding one value", () => {
      const userConfig = { rateLimit: { concurrency: 5 } };

      const config = resolveConfig({}, userConfig);

      expect(config.concurrency).toBe(5);
      expect(config.debounceMs).toBe(CONFIG_DEFAULTS.debounceMs);
      expect(config.retryAttempts).toBe(CONFIG_DEFAULTS.retryAttempts);
    });

    it("applies logging settings from config", () => {
      const userConfig = { logging: { level: "debug" as const, json: true } };

      const config = resolveConfig({}, userConfig);

      expect(config.logLevel).toBe("debug");
      expect(config.logJson).toBe(true);
    });

    it("applies health settings from config", () => {
      const userConfig = {
        health: { enabled: false, socketPath: "/custom/path.sock" },
      };

      const config = resolveConfig({}, userConfig);

      expect(config.healthEnabled).toBe(false);
      expect(config.healthSocketPath).toBe("/custom/path.sock");
    });

    it("applies watch patterns from config", () => {
      const userConfig = { watch: { patterns: ["*.doc", "*.txt"] } };

      const config = resolveConfig({}, userConfig);

      expect(config.patterns).toEqual(["*.doc", "*.txt"]);
    });
  });

  describe("ConfigFileSchema", () => {
    it("validates correct config", () => {
      const input = {
        watch: { patterns: ["*.pdf"] },
        rateLimit: { concurrency: 3 },
      };

      const result = ConfigFileSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates empty config", () => {
      const result = ConfigFileSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it("rejects invalid concurrency (too high)", () => {
      const input = {
        rateLimit: { concurrency: 100 },
      };

      const result = ConfigFileSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects invalid concurrency (too low)", () => {
      const input = {
        rateLimit: { concurrency: 0 },
      };

      const result = ConfigFileSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects invalid debounceMs (too low)", () => {
      const input = {
        rateLimit: { debounceMs: 50 },
      };

      const result = ConfigFileSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("accepts valid logging level", () => {
      const input = {
        logging: { level: "debug" },
      };

      const result = ConfigFileSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("rejects invalid logging level", () => {
      const input = {
        logging: { level: "verbose" },
      };

      const result = ConfigFileSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("loadConfigFile", () => {
    it("returns undefined for non-existent file", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = loadConfigFile("/path/to/config.yaml");

      expect(result).toBeUndefined();
    });

    it("loads and parses valid YAML file", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
rateLimit:
  concurrency: 4
logging:
  level: debug
`);

      const result = loadConfigFile("/path/to/config.yaml");

      expect(result).toBeDefined();
      expect(result?.rateLimit?.concurrency).toBe(4);
      expect(result?.logging?.level).toBe("debug");
    });

    it("handles empty YAML file", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("");

      const result = loadConfigFile("/path/to/config.yaml");

      expect(result).toEqual({});
    });

    it("throws on invalid YAML syntax", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
rateLimit:
  concurrency: [invalid
`);

      expect(() => loadConfigFile("/path/to/config.yaml")).toThrow(
        /Invalid YAML/
      );
    });

    it("throws on schema validation failure", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
rateLimit:
  concurrency: 999
`);

      expect(() => loadConfigFile("/path/to/config.yaml")).toThrow(
        /Config validation failed/
      );
    });
  });
});
