import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createApiClient, type TokenStore, type StoredTokens } from "./api-client.js";

class MemoryStore implements TokenStore {
  constructor(private value: StoredTokens = {}) {}
  getTokens() {
    return this.value;
  }
  setTokens(tokens: StoredTokens) {
    this.value = tokens;
  }
  clearTokens() {
    this.value = {};
  }
}

describe("createApiClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses legacy token when provided", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ hello: "world" })
    }));

    const client = createApiClient({ fetchImpl: fetchImpl as any });
    client.setLegacyToken("abc123");

    await expect(client.get("/test")).resolves.toEqual({ hello: "world" });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET"
      })
    );
    const call = fetchImpl.mock.calls[0];
    const headers = call[1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer abc123");
  });

  it("refreshes expired tokens", async () => {
    const store = new MemoryStore({
      accessToken: "expired",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1
    });

    const fetchImpl = vi.fn(async (url: any) => {
      if (typeof url === "string" && url.includes("/api/oauth/token")) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            access_token: "new-access",
            refresh_token: "refresh",
            token_type: "Bearer",
            expires_in: 3600
          })
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true })
      } as Response;
    });

    const client = createApiClient({
      oauthBaseUrl: "https://renamed.to",
      clientId: "client",
      clientSecret: "secret",
      tokenStore: store,
      fetchImpl: fetchImpl as any
    });

    await expect(client.get("/test")).resolves.toEqual({ ok: true });
    expect(store.getTokens().accessToken).toBe("new-access");
  });
});
