import { beforeEach, afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Command } from "commander";
import { resolveToken, registerAuthCommands } from "./auth.js";

// Mock ora
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: ""
  })
}));

// Mock chalk with full API including chained methods
vi.mock("chalk", () => {
  const identity = (s: string) => s;
  const boldMock = Object.assign(identity, {
    cyan: identity,
    yellow: identity,
    green: identity,
    red: identity,
    gray: identity,
  });
  return {
    default: {
      red: identity,
      green: identity,
      cyan: identity,
      yellow: identity,
      gray: identity,
      bold: boldMock,
    }
  };
});

// Mock device-flow
vi.mock("./device-flow.js", () => ({
  runDeviceAuth: vi.fn()
}));

import { runDeviceAuth } from "./device-flow.js";

describe("resolveToken", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns provided token option", async () => {
    await expect(resolveToken({ token: "abc" })).resolves.toBe("abc");
  });

  it("prompts for token when missing", async () => {
    vi.mock("prompts", () => ({
      default: vi.fn(() => Promise.resolve({ token: "prompted" }))
    }));

    const { resolveToken: mockedResolve } = await import("./auth.js");
    await expect(mockedResolve({})).resolves.toBe("prompted");
  });

  it("throws if non-interactive without token", async () => {
    await expect(resolveToken({ nonInteractive: true })).rejects.toThrow(/interactive/);
  });

  it("throws if prompt returns empty token", async () => {
    vi.doMock("prompts", () => ({
      default: vi.fn(() => Promise.resolve({ token: "" }))
    }));

    const { resolveToken: mockedResolve } = await import("./auth.js");
    await expect(mockedResolve({})).rejects.toThrow(/required/);
  });
});

describe("registerAuthCommands", () => {
  let program: Command;
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  const createMockApi = () => ({
    setLegacyToken: vi.fn(),
    clearToken: vi.fn(),
    storeOAuthTokens: vi.fn(),
    get: vi.fn()
  });

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth logout", () => {
    it("clears token and shows success message", async () => {
      const api = createMockApi();
      registerAuthCommands(program, api as never);

      await program.parseAsync(["node", "test", "auth", "logout"]);

      expect(api.clearToken).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Signed out")
      );
    });
  });

  describe("auth whoami", () => {
    it("displays profile information", async () => {
      const api = createMockApi();
      api.get.mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        name: "Test User"
      });
      registerAuthCommands(program, api as never);

      await program.parseAsync(["node", "test", "auth", "whoami"]);

      expect(api.get).toHaveBeenCalledWith("/user");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("user-123"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("test@example.com"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Test User"));
    });

    it("handles API errors", async () => {
      const api = createMockApi();
      api.get.mockRejectedValue(new Error("Not authenticated"));
      registerAuthCommands(program, api as never);

      await program.parseAsync(["node", "test", "auth", "whoami"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Not authenticated")
      );
      expect(process.exitCode).toBe(1);
    });

    it("handles profile without optional fields", async () => {
      const api = createMockApi();
      api.get.mockResolvedValue({ id: "user-123" });
      registerAuthCommands(program, api as never);

      await program.parseAsync(["node", "test", "auth", "whoami"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("user-123"));
    });
  });

  describe("auth device", () => {
    it("runs device auth flow and stores tokens", async () => {
      const api = createMockApi();
      const mockTokens = {
        access_token: "access-123",
        refresh_token: "refresh-456"
      };
      vi.mocked(runDeviceAuth).mockResolvedValue(mockTokens);
      registerAuthCommands(program, api as never);

      await program.parseAsync(["node", "test", "auth", "device"]);

      expect(runDeviceAuth).toHaveBeenCalled();
      expect(api.storeOAuthTokens).toHaveBeenCalledWith(mockTokens);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("successful")
      );
    });

    it("handles device auth errors", async () => {
      const api = createMockApi();
      vi.mocked(runDeviceAuth).mockRejectedValue(new Error("Device auth failed"));
      registerAuthCommands(program, api as never);

      await program.parseAsync(["node", "test", "auth", "device"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Device auth failed")
      );
      expect(process.exitCode).toBe(1);
    });

    it("uses custom client ID from options", async () => {
      const api = createMockApi();
      vi.mocked(runDeviceAuth).mockResolvedValue({ access_token: "token" });
      registerAuthCommands(program, api as never);

      await program.parseAsync([
        "node", "test", "auth", "device",
        "--client-id", "custom-client-id"
      ]);

      expect(runDeviceAuth).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: "custom-client-id" })
      );
    });

    it("passes scope option to device auth", async () => {
      const api = createMockApi();
      vi.mocked(runDeviceAuth).mockResolvedValue({ access_token: "token" });
      registerAuthCommands(program, api as never);

      await program.parseAsync([
        "node", "test", "auth", "device",
        "--scope", "read write"
      ]);

      expect(runDeviceAuth).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "read write" })
      );
    });
  });

  describe("auth login", () => {
    it("saves token with --token flag", async () => {
      const api = createMockApi();
      registerAuthCommands(program, api as never);

      await program.parseAsync([
        "node", "test", "auth", "login",
        "--token", "my-api-token"
      ]);

      expect(api.setLegacyToken).toHaveBeenCalledWith("my-api-token", undefined);
    });

    it("saves token with custom scheme", async () => {
      const api = createMockApi();
      registerAuthCommands(program, api as never);

      await program.parseAsync([
        "node", "test", "auth", "login",
        "--token", "my-token",
        "--scheme", "ApiKey"
      ]);

      expect(api.setLegacyToken).toHaveBeenCalledWith("my-token", "ApiKey");
    });

    it("handles login errors", async () => {
      const api = createMockApi();
      registerAuthCommands(program, api as never);

      await program.parseAsync([
        "node", "test", "auth", "login",
        "--non-interactive"
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("interactive")
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
