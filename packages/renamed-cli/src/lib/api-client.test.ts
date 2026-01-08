import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createApiClient, type TokenStore, type StoredTokens } from "./api-client.js";

// Mock fs for upload tests
vi.mock("fs", () => ({
  readFileSync: vi.fn(() => Buffer.from("fake pdf content"))
}));

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

  describe("authentication", () => {
    it("uses legacy token when provided", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ hello: "world" })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("abc123");

      await expect(client.get("/test")).resolves.toEqual({ hello: "world" });
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining("/test"),
        expect.objectContaining({
          method: "GET"
        })
      );
      const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const headers = call[1].headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer abc123");
    });

    it("uses custom scheme with legacy token", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ ok: true })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("mytoken", "Token");

      await client.get("/test");

      const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const headers = call[1].headers as Headers;
      expect(headers.get("Authorization")).toBe("Token mytoken");
    });

    it("throws error when no credentials stored", async () => {
      const store = new MemoryStore({});
      const client = createApiClient({ tokenStore: store });

      await expect(client.get("/test")).rejects.toThrow("You need to log in first");
    });

    it("throws error when access token expired and no refresh token", async () => {
      const store = new MemoryStore({
        accessToken: "expired",
        expiresAt: Date.now() - 1000 // Expired
        // No refreshToken
      });

      const client = createApiClient({ tokenStore: store });

      await expect(client.get("/test")).rejects.toThrow("Your session has expired");
    });

    it("uses valid non-expired token without refresh", async () => {
      const store = new MemoryStore({
        accessToken: "valid-token",
        tokenType: "Bearer",
        expiresAt: Date.now() + 60000 // Valid for 1 minute
      });

      const fetchImpl = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ data: "result" })
      }));

      const client = createApiClient({
        tokenStore: store,
        fetchImpl: fetchImpl as unknown as typeof fetch
      });

      await client.get("/test");

      // Should only make one call (the actual request, no refresh)
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("refreshes expired tokens", async () => {
      const store = new MemoryStore({
        accessToken: "expired",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: Date.now() - 1
      });

      const fetchImpl = vi.fn(async (url: URL | string) => {
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
        fetchImpl: fetchImpl as unknown as typeof fetch
      });

      await expect(client.get("/test")).resolves.toEqual({ ok: true });
      expect(store.getTokens().accessToken).toBe("new-access");
    });

    it("throws error when refresh fails due to missing client ID", async () => {
      const store = new MemoryStore({
        accessToken: "expired",
        refreshToken: "refresh",
        expiresAt: Date.now() - 1
      });

      const client = createApiClient({
        clientId: undefined,
        tokenStore: store
      });

      await expect(client.get("/test")).rejects.toThrow("Couldn't refresh your session");
    });

    it("clears tokens on clearToken call", () => {
      const store = new MemoryStore({
        accessToken: "token",
        refreshToken: "refresh"
      });

      const client = createApiClient({ tokenStore: store });
      client.setLegacyToken("legacy");
      client.clearToken();

      expect(store.getTokens()).toEqual({});
    });
  });

  describe("HTTP methods", () => {
    const createMockClient = () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ success: true })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("token");

      return { client, fetchImpl };
    };

    it("makes GET requests", async () => {
      const { client, fetchImpl } = createMockClient();

      await client.get("/resource");

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining("/resource"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("makes POST requests with body", async () => {
      const { client, fetchImpl } = createMockClient();

      await client.post("/resource", { name: "test" });

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining("/resource"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "test" })
        })
      );
    });

    it("makes PATCH requests with body", async () => {
      const { client, fetchImpl } = createMockClient();

      await client.patch("/resource", { updated: true });

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining("/resource"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ updated: true })
        })
      );
    });

    it("makes DELETE requests", async () => {
      const { client, fetchImpl } = createMockClient();

      await client.delete("/resource");

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining("/resource"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("error handling", () => {
    it("throws error on non-OK response with JSON error", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => JSON.stringify({ error: "Invalid input" })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("token");

      await expect(client.get("/test")).rejects.toThrow("The request couldn't be processed");
    });

    it("throws error on non-OK response with plain text error", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Something went wrong"
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("token");

      await expect(client.get("/test")).rejects.toThrow("Something went wrong on our end");
    });

    it("throws OAuth error on refresh failure", async () => {
      const store = new MemoryStore({
        accessToken: "expired",
        refreshToken: "bad-refresh",
        expiresAt: Date.now() - 1
      });

      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => JSON.stringify({
          error: "invalid_grant",
          error_description: "Refresh token expired"
        })
      }));

      const client = createApiClient({
        clientId: "client",
        tokenStore: store,
        fetchImpl: fetchImpl as unknown as typeof fetch
      });

      // 401 on OAuth token endpoint is treated as "not authenticated"
      await expect(client.get("/test")).rejects.toThrow("You need to log in first");
    });
  });

  describe("file uploads", () => {
    it("uploads file with uploadFile method", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ uploaded: true })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("token");

      const result = await client.uploadFile("/upload", "/path/to/file.pdf");

      expect(result).toEqual({ uploaded: true });
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining("/upload"),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("uploads file with custom field name", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ uploaded: true })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("token");

      await client.uploadFile("/upload", "/path/to/file.pdf", "document");

      expect(fetchImpl).toHaveBeenCalled();
    });

    it("uploads file with additional fields", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ extracted: true })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("token");

      const result = await client.uploadFileWithFields(
        "/extract",
        "/path/to/file.pdf",
        [
          { name: "schema", value: '{"fields":[]}' },
          { name: "instructions", value: "Extract all" }
        ]
      );

      expect(result).toEqual({ extracted: true });
    });

    it("throws error on upload failure", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
        text: async () => JSON.stringify({ error: "File too large" })
      }));

      const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      client.setLegacyToken("token");

      // 413 is mapped to a generic API error with the error message
      await expect(client.uploadFile("/upload", "/big-file.pdf")).rejects.toThrow(
        /Request failed|File too large/
      );
    });
  });

  describe("token management", () => {
    it("stores OAuth tokens via storeOAuthTokens", () => {
      const store = new MemoryStore();
      const client = createApiClient({ tokenStore: store });

      client.storeOAuthTokens({
        access_token: "access-123",
        refresh_token: "refresh-456",
        token_type: "Bearer",
        expires_in: 3600
      });

      const tokens = store.getTokens();
      expect(tokens.accessToken).toBe("access-123");
      expect(tokens.refreshToken).toBe("refresh-456");
      expect(tokens.tokenType).toBe("Bearer");
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    });

    it("handles tokens without expires_in", () => {
      const store = new MemoryStore();
      const client = createApiClient({ tokenStore: store });

      client.storeOAuthTokens({
        access_token: "access-123"
      });

      const tokens = store.getTokens();
      expect(tokens.accessToken).toBe("access-123");
      expect(tokens.expiresAt).toBeUndefined();
    });

    it("refresh method throws when no refresh token", async () => {
      const store = new MemoryStore({
        accessToken: "token"
        // No refresh token
      });

      const client = createApiClient({ tokenStore: store });

      await expect(client.refresh()).rejects.toThrow("Your session has expired");
    });

    it("refresh method updates tokens", async () => {
      const store = new MemoryStore({
        accessToken: "old-access",
        refreshToken: "refresh-token"
      });

      const fetchImpl = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 7200
        })
      }));

      const client = createApiClient({
        clientId: "client",
        tokenStore: store,
        fetchImpl: fetchImpl as unknown as typeof fetch
      });

      await client.refresh();

      expect(store.getTokens().accessToken).toBe("new-access");
      expect(store.getTokens().refreshToken).toBe("new-refresh");
    });
  });
});
