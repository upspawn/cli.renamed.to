import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createLogger, createNoopLogger, type Logger, type LogLevel } from "./logger.js";

describe("logger", () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createLogger", () => {
    describe("log level filtering", () => {
      it("logs debug when level is debug", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.debug("test message");
        expect(consoleLogSpy).toHaveBeenCalled();
      });

      it("does not log debug when level is info", () => {
        const logger = createLogger({ level: "info", json: false });
        logger.debug("test message");
        expect(consoleLogSpy).not.toHaveBeenCalled();
      });

      it("logs info when level is info", () => {
        const logger = createLogger({ level: "info", json: false });
        logger.info("test message");
        expect(consoleLogSpy).toHaveBeenCalled();
      });

      it("logs warn when level is warn", () => {
        const logger = createLogger({ level: "warn", json: false });
        logger.warn("test message");
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      it("logs error when level is error", () => {
        const logger = createLogger({ level: "error", json: false });
        logger.error("test message");
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      it("does not log warn when level is error", () => {
        const logger = createLogger({ level: "error", json: false });
        logger.warn("test message");
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      });
    });

    describe("output routing", () => {
      it("logs debug to stdout", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.debug("debug message");
        expect(consoleLogSpy).toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      });

      it("logs info to stdout", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.info("info message");
        expect(consoleLogSpy).toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      });

      it("logs warn to stderr", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.warn("warn message");
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(consoleLogSpy).not.toHaveBeenCalled();
      });

      it("logs error to stderr", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.error("error message");
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });

    describe("JSON format", () => {
      it("outputs JSON when json option is true", () => {
        const logger = createLogger({ level: "debug", json: true });
        logger.info("test message");

        expect(consoleLogSpy).toHaveBeenCalled();
        const output = consoleLogSpy.mock.calls[0][0] as string;
        const parsed = JSON.parse(output);

        expect(parsed.message).toBe("test message");
        expect(parsed.level).toBe("info");
        expect(parsed.timestamp).toBeDefined();
      });

      it("includes metadata in JSON output", () => {
        const logger = createLogger({ level: "debug", json: true });
        logger.info("test message", { key: "value", count: 42 });

        const output = consoleLogSpy.mock.calls[0][0] as string;
        const parsed = JSON.parse(output);

        expect(parsed.key).toBe("value");
        expect(parsed.count).toBe(42);
      });
    });

    describe("human-readable format", () => {
      it("includes timestamp in human-readable format", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.info("test message");

        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("includes level in uppercase", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.info("test message");

        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain("INFO");
      });

      it("includes message", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.info("test message");

        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain("test message");
      });

      it("includes metadata as JSON when provided", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.info("test message", { key: "value" });

        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain('{"key":"value"}');
      });

      it("omits metadata section when empty", () => {
        const logger = createLogger({ level: "debug", json: false });
        logger.info("test message");

        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).not.toContain("{}");
      });
    });

    describe("child logger", () => {
      it("creates a child logger with inherited options", () => {
        const logger = createLogger({ level: "debug", json: true });
        const child = logger.child({ service: "test" });

        child.info("child message");

        const output = consoleLogSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);

        expect(parsed.service).toBe("test");
        expect(parsed.message).toBe("child message");
      });

      it("child logger includes default meta on all logs", () => {
        const logger = createLogger({ level: "debug", json: true });
        const child = logger.child({ service: "test" });

        child.info("message 1");
        child.warn("message 2");

        const output1 = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        const output2 = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);

        expect(output1.service).toBe("test");
        expect(output2.service).toBe("test");
      });

      it("per-call metadata overrides default meta", () => {
        const logger = createLogger({ level: "debug", json: true });
        const child = logger.child({ service: "default" });

        child.info("message", { service: "override" });

        const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(output.service).toBe("override");
      });

      it("supports nested child loggers", () => {
        const logger = createLogger({ level: "debug", json: true });
        const child1 = logger.child({ level1: "value1" });
        const child2 = child1.child({ level2: "value2" });

        child2.info("nested message");

        const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(output.level1).toBe("value1");
        expect(output.level2).toBe("value2");
      });
    });
  });

  describe("createNoopLogger", () => {
    it("returns a logger that does nothing", () => {
      const logger = createNoopLogger();

      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("child() returns the same noop logger", () => {
      const logger = createNoopLogger();
      const child = logger.child({ service: "test" });

      child.info("test");

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("child() returns a functional logger interface", () => {
      const logger = createNoopLogger();
      const child = logger.child({ service: "test" });

      expect(typeof child.debug).toBe("function");
      expect(typeof child.info).toBe("function");
      expect(typeof child.warn).toBe("function");
      expect(typeof child.error).toBe("function");
      expect(typeof child.child).toBe("function");
    });
  });
});
