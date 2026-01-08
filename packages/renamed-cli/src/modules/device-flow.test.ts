import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pollForTokens, requestDeviceCode, runDeviceAuth } from "./device-flow.js";
import type { BrowserService } from "../lib/ports/browser.js";
import type { PromptService } from "../lib/ports/prompt.js";

// Mock ora
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  }),
}));

// Mock chalk
vi.mock("chalk", () => ({
  default: { cyan: (s: string) => s },
}));

const CONFIG = {
  baseUrl: "https://renamed.to",
  clientId: "client",
  clientSecret: "secret",
  scope: "read",
  pollInterval: 1,
  openBrowser: false,
} as const;

const PUBLIC_CONFIG = {
  ...CONFIG,
  clientSecret: undefined,
} as const;

const DEVICE_RESPONSE = {
  device_code: "device-123",
  user_code: "ABCD-1234",
  verification_uri: "https://renamed.to/device",
  verification_uri_complete: "https://renamed.to/device?code=ABCD-1234",
  expires_in: 600,
  interval: 1,
};

// Helper to create instant delay for tests
const instantDelay = () => Promise.resolve();

describe("device flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("requestDeviceCode", () => {
    it("requests device code from API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => DEVICE_RESPONSE,
      });

      const result = await requestDeviceCode(CONFIG, { fetchImpl: mockFetch });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://renamed.to/api/oauth/device",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
      expect(result.device_code).toBe("device-123");
      expect(result.user_code).toBe("ABCD-1234");
    });

    it("uses config pollInterval when server does not provide interval", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...DEVICE_RESPONSE, interval: undefined }),
      });

      const result = await requestDeviceCode(
        { ...CONFIG, pollInterval: 10 },
        { fetchImpl: mockFetch }
      );

      expect(result.interval).toBe(10);
    });

    it("throws on API error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Bad Request",
        json: async () => ({
          error: "invalid_client",
          error_description: "Client not found",
        }),
      });

      await expect(
        requestDeviceCode(CONFIG, { fetchImpl: mockFetch })
      ).rejects.toThrow("Client not found");
    });
  });

  describe("pollForTokens", () => {
    it("resolves after authorization pending turns into success", async () => {
      const responses = [
        { ok: false, body: { error: "authorization_pending" } },
        {
          ok: true,
          body: {
            access_token: "abc",
            refresh_token: "def",
            token_type: "Bearer",
            expires_in: 3600,
          },
        },
      ];

      const mockFetch = vi.fn().mockImplementation(async () => {
        const next = responses.shift();
        if (!next) throw new Error("Unexpected fetch call");
        return { ok: next.ok, json: async () => next.body };
      });

      const promise = pollForTokens(CONFIG, DEVICE_RESPONSE, {
        fetchImpl: mockFetch,
        delay: instantDelay,
      });

      await expect(promise).resolves.toMatchObject({ access_token: "abc" });
    });

    it("throws when user denies access", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "access_denied" }),
      });

      await expect(
        pollForTokens(CONFIG, { ...DEVICE_RESPONSE, expires_in: 10 }, {
          fetchImpl: mockFetch,
          delay: instantDelay,
        })
      ).rejects.toThrow(/denied/);
    });

    it("increases interval on slow_down response", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: false, json: async () => ({ error: "slow_down" }) };
        }
        return { ok: true, json: async () => ({ access_token: "token" }) };
      });

      const result = await pollForTokens(CONFIG, DEVICE_RESPONSE, {
        fetchImpl: mockFetch,
        delay: instantDelay,
      });

      expect(result.access_token).toBe("token");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws on expired_token error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "expired_token" }),
      });

      await expect(
        pollForTokens(CONFIG, { ...DEVICE_RESPONSE, expires_in: 10 }, {
          fetchImpl: mockFetch,
          delay: instantDelay,
        })
      ).rejects.toThrow(/expired/);
    });

    it("throws on unknown error with description", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "server_error",
          error_description: "Internal error",
        }),
      });

      await expect(
        pollForTokens(CONFIG, { ...DEVICE_RESPONSE, expires_in: 10 }, {
          fetchImpl: mockFetch,
          delay: instantDelay,
        })
      ).rejects.toThrow("Internal error");
    });

    it("does not include client_secret for public clients", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "token" }),
      });

      await pollForTokens(PUBLIC_CONFIG, DEVICE_RESPONSE, {
        fetchImpl: mockFetch,
        delay: instantDelay,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty("client_secret");
    });

    it("includes client_secret for confidential clients", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "token" }),
      });

      await pollForTokens(CONFIG, DEVICE_RESPONSE, {
        fetchImpl: mockFetch,
        delay: instantDelay,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.client_secret).toBe("secret");
    });
  });

  describe("runDeviceAuth", () => {
    const createMockBrowser = (): BrowserService => ({
      open: vi.fn().mockResolvedValue(undefined),
    });

    const createMockPrompts = (confirmResult = true): PromptService => ({
      confirm: vi.fn().mockResolvedValue(confirmResult),
      password: vi.fn(),
    });

    const createSuccessfulFetch = () =>
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => DEVICE_RESPONSE,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "token" }),
        });

    it("opens browser automatically when openBrowser is true", async () => {
      const mockBrowser = createMockBrowser();
      const mockPrompts = createMockPrompts();
      const mockFetch = createSuccessfulFetch();

      await runDeviceAuth(
        { ...CONFIG, openBrowser: true },
        {
          fetchImpl: mockFetch,
          browserService: mockBrowser,
          promptService: mockPrompts,
          delay: instantDelay,
        }
      );

      expect(mockBrowser.open).toHaveBeenCalledWith(
        expect.stringContaining("device")
      );
      expect(mockPrompts.confirm).not.toHaveBeenCalled();
    });

    it("prompts user when openBrowser is false and opens on confirm", async () => {
      const mockBrowser = createMockBrowser();
      const mockPrompts = createMockPrompts(true);
      const mockFetch = createSuccessfulFetch();

      await runDeviceAuth(
        { ...CONFIG, openBrowser: false },
        {
          fetchImpl: mockFetch,
          browserService: mockBrowser,
          promptService: mockPrompts,
          delay: instantDelay,
        }
      );

      expect(mockPrompts.confirm).toHaveBeenCalled();
      expect(mockBrowser.open).toHaveBeenCalled();
    });

    it("does not open browser when user declines", async () => {
      const mockBrowser = createMockBrowser();
      const mockPrompts = createMockPrompts(false);
      const mockFetch = createSuccessfulFetch();

      await runDeviceAuth(
        { ...CONFIG, openBrowser: false },
        {
          fetchImpl: mockFetch,
          browserService: mockBrowser,
          promptService: mockPrompts,
          delay: instantDelay,
        }
      );

      expect(mockPrompts.confirm).toHaveBeenCalled();
      expect(mockBrowser.open).not.toHaveBeenCalled();
    });

    it("returns tokens on successful auth", async () => {
      const mockBrowser = createMockBrowser();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => DEVICE_RESPONSE,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "access-123",
            refresh_token: "refresh-456",
          }),
        });

      const result = await runDeviceAuth(
        { ...CONFIG, openBrowser: true },
        {
          fetchImpl: mockFetch,
          browserService: mockBrowser,
          delay: instantDelay,
        }
      );

      expect(result.access_token).toBe("access-123");
      expect(result.refresh_token).toBe("refresh-456");
    });
  });
});
