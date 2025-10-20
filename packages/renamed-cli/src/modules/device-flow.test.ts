import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pollForTokens } from "./device-flow.js";

const CONFIG = {
  baseUrl: "https://renamed.to",
  clientId: "client",
  clientSecret: "secret",
  scope: "read",
  pollInterval: 1,
  openBrowser: false
} as const;

describe("device flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves after authorization pending turns into success", async () => {
    const responses = [
      { ok: false, body: { error: "authorization_pending" } },
      {
        ok: true,
        body: { access_token: "abc", refresh_token: "def", token_type: "Bearer", expires_in: 3600 }
      }
    ];

    vi.spyOn(global, "fetch").mockImplementation(async () => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected fetch call");
      return {
        ok: next.ok,
        json: async () => next.body
      } as Response;
    });

    const promise = pollForTokens(CONFIG, {
      device_code: "device",
      user_code: "ABCD",
      verification_uri: "https://renamed.to/device",
      verification_uri_complete: "https://renamed.to/device?code=ABCD",
      expires_in: 600,
      interval: 1
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toMatchObject({ access_token: "abc" });
  });

  it("throws when user denies access", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "access_denied" })
    } as Response);

    const promise = pollForTokens(CONFIG, {
      device_code: "device",
      user_code: "ABCD",
      verification_uri: "https://renamed.to/device",
      verification_uri_complete: "https://renamed.to/device?code=ABCD",
      expires_in: 10,
      interval: 1
    });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).rejects.toThrow(/denied/);
  });
});
