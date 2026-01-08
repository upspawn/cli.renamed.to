import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { Command } from "commander";
import { registerConfigCommands } from "./config-cmd.js";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock chalk to avoid color codes in tests
vi.mock("chalk", () => ({
  default: {
    red: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
    gray: (s: string) => s,
    bold: (s: string) => s,
  },
}));

// Mock config module
vi.mock("../lib/config.js", () => ({
  loadConfig: vi.fn(),
  loadConfigFile: vi.fn(),
  USER_CONFIG_PATH: "/home/user/.config/renamed/config.yaml",
  SYSTEM_CONFIG_PATH: "/etc/renamed/config.yaml",
}));

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { loadConfig, loadConfigFile } from "../lib/config.js";

describe("config-cmd", () => {
  let program: Command;
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerConfigCommands(program);

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("config init", () => {
    it("creates user config file when it does not exist", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await program.parseAsync(["node", "test", "config", "init"]);

      expect(mkdirSync).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".config/renamed/config.yaml"),
        expect.stringContaining("# renamed.to CLI Configuration"),
        "utf-8"
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Created config file")
      );
    });

    it("creates system config with --global flag", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await program.parseAsync(["node", "test", "config", "init", "--global"]);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/etc/renamed/config.yaml"),
        expect.any(String),
        "utf-8"
      );
    });

    it("does not overwrite existing config file", async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      await program.parseAsync(["node", "test", "config", "init"]);

      expect(writeFileSync).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("already exists")
      );
      expect(process.exitCode).toBe(1);
    });

    it("handles write errors gracefully", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      await program.parseAsync(["node", "test", "config", "init"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create config")
      );
      expect(process.exitCode).toBe(1);
    });

    it("suggests sudo for global config errors", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      await program.parseAsync(["node", "test", "config", "init", "--global"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("require sudo")
      );
    });
  });

  describe("config validate", () => {
    it("validates existing config files", async () => {
      vi.mocked(existsSync).mockImplementation((path) =>
        String(path).includes("user")
      );
      vi.mocked(loadConfigFile).mockReturnValue({});

      await program.parseAsync(["node", "test", "config", "validate"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Valid")
      );
    });

    it("validates specific config file with -c option", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfigFile).mockReturnValue({});

      await program.parseAsync([
        "node",
        "test",
        "config",
        "validate",
        "-c",
        "/custom/config.yaml",
      ]);

      expect(loadConfigFile).toHaveBeenCalledWith("/custom/config.yaml");
    });

    it("reports validation errors", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfigFile).mockImplementation(() => {
        throw new Error("Invalid schema");
      });

      await program.parseAsync([
        "node",
        "test",
        "config",
        "validate",
        "-c",
        "/bad/config.yaml",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid")
      );
      expect(process.exitCode).toBe(1);
    });

    it("reports file not found for specific path", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await program.parseAsync([
        "node",
        "test",
        "config",
        "validate",
        "-c",
        "/missing/config.yaml",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("File not found")
      );
      expect(process.exitCode).toBe(1);
    });

    it("shows message when no config files found", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await program.parseAsync(["node", "test", "config", "validate"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("No configuration files found")
      );
    });

    it("shows success message when all files valid", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfigFile).mockReturnValue({});

      await program.parseAsync(["node", "test", "config", "validate"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All configuration files are valid")
      );
    });
  });

  describe("config show", () => {
    it("displays effective configuration", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        config: {
          concurrency: 2,
          debounceMs: 1000,
          retryAttempts: 3,
          retryDelayMs: 5000,
          patterns: ["*.pdf", "*.jpg"],
          logLevel: "info" as const,
          logJson: false,
          healthEnabled: true,
          healthSocketPath: "/tmp/renamed-health.sock",
        },
        sources: ["/home/user/.config/renamed/config.yaml"],
      });

      await program.parseAsync(["node", "test", "config", "show"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Effective Configuration")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("concurrency")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("*.pdf")
      );
    });

    it("shows defaults only message when no sources", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        config: {
          concurrency: 2,
          debounceMs: 1000,
          retryAttempts: 3,
          retryDelayMs: 5000,
          patterns: ["*.pdf"],
          logLevel: "info" as const,
          logJson: false,
          healthEnabled: true,
          healthSocketPath: "/tmp/renamed-health.sock",
        },
        sources: [],
      });

      await program.parseAsync(["node", "test", "config", "show"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("defaults only")
      );
    });

    it("handles config loading errors", async () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error("Config parse error");
      });

      await program.parseAsync(["node", "test", "config", "show"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load config")
      );
      expect(process.exitCode).toBe(1);
    });

    it("uses custom config path with -c option", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        config: {
          concurrency: 2,
          debounceMs: 1000,
          retryAttempts: 3,
          retryDelayMs: 5000,
          patterns: [],
          logLevel: "info" as const,
          logJson: false,
          healthEnabled: true,
          healthSocketPath: "/tmp/renamed-health.sock",
        },
        sources: [],
      });

      await program.parseAsync([
        "node",
        "test",
        "config",
        "show",
        "-c",
        "/custom/config.yaml",
      ]);

      expect(loadConfig).toHaveBeenCalledWith("/custom/config.yaml");
    });
  });

  describe("config path", () => {
    it("displays config file locations", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await program.parseAsync(["node", "test", "config", "path"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("User config")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("System config")
      );
    });

    it("indicates when config files exist", async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      await program.parseAsync(["node", "test", "config", "path"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("exists")
      );
    });

    it("indicates when config files do not exist", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await program.parseAsync(["node", "test", "config", "path"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("not found")
      );
    });
  });
});
