import type { RequestInit } from "node-fetch";
import fetch, { Headers } from "node-fetch";
import FormData from "form-data";
import { readFileSync } from "fs";
import Conf from "conf";

export interface StoredTokens {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
}

export interface TokenStore {
  getTokens(): StoredTokens;
  setTokens(tokens: StoredTokens): void;
  clearTokens(): void;
}

export class ConfTokenStore implements TokenStore {
  private readonly conf = new Conf<StoredTokens>({ projectName: "renamed-cli" });

  getTokens(): StoredTokens {
    return {
      accessToken: this.conf.get("accessToken"),
      refreshToken: this.conf.get("refreshToken"),
      tokenType: this.conf.get("tokenType"),
      scope: this.conf.get("scope"),
      expiresAt: this.conf.get("expiresAt")
    };
  }

  setTokens(tokens: StoredTokens): void {
    const now = Date.now();
    if (tokens.expiresAt && tokens.expiresAt < now) {
      throw new Error("Refusing to persist already-expired tokens.");
    }
    this.conf.set(tokens);
  }

  clearTokens(): void {
    this.conf.clear();
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  oauthBaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  tokenStore?: TokenStore;
  fetchImpl?: typeof fetch;
}

export interface OAuthTokenPayload {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
  uploadFile<T>(path: string, filePath: string, fieldName?: string): Promise<T>;
  setLegacyToken(token: string, scheme?: string): void;
  clearToken(): void;
  refresh(): Promise<void>;
  storeOAuthTokens(payload: OAuthTokenPayload): void;
}

export function createApiClient({
  baseUrl = "https://api.renamed.to/v1",
  oauthBaseUrl = "https://renamed.to",
  clientId = process.env.RENAMED_CLIENT_ID,
  clientSecret = process.env.RENAMED_CLIENT_SECRET,
  tokenStore = new ConfTokenStore(),
  fetchImpl = fetch
}: ApiClientOptions = {}): ApiClient {
  let legacyToken: { token?: string; scheme: string } = { scheme: "Bearer" };

  async function ensureAccessToken() {
    if (legacyToken.token) return legacyToken;

    const tokens = tokenStore.getTokens();
    if (!tokens.accessToken) {
      throw new Error("No credentials stored. Run `renamed auth login` or `renamed auth device`.");
    }

    if (tokens.expiresAt && tokens.expiresAt > Date.now() + 30_000) {
      return {
        token: tokens.accessToken,
        scheme: tokens.tokenType ?? "Bearer"
      };
    }

    if (!tokens.refreshToken) {
      throw new Error("Stored access token expired and no refresh token is available.");
    }

    await refreshWith(tokens.refreshToken);
    const next = tokenStore.getTokens();
    return {
      token: next.accessToken,
      scheme: next.tokenType ?? "Bearer"
    };
  }

  async function refreshWith(refreshToken: string) {
    if (!clientId) throw new Error("RENAMED_CLIENT_ID is required to refresh tokens.");

    const body = {
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    };

    const response = await fetchJson(`${oauthBaseUrl}/api/oauth/token`, body);
    persistTokens(response);
  }

  function persistTokens(payload: OAuthTokenPayload) {
    tokenStore.setTokens({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type ?? "Bearer",
      scope: payload.scope,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined
    });
  }

  async function fetchJson(url: string, body: unknown) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const message = data.error_description ?? data.error ?? res.statusText;
      throw new Error(`OAuth error (${res.status}): ${message}`);
    }

    return data;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const context = await ensureAccessToken();
    const token = context.token;
    const scheme = context.scheme;

    if (!token) throw new Error("No access token available.");

    const headers = new Headers(init.headers ?? {});
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
    headers.set("Authorization", `${scheme} ${token}`);

    const response = await fetchImpl(new URL(path, baseUrl), {
      ...init,
      headers
    });

    const text = await response.text();
    if (!response.ok) {
      let payload: any = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        /* ignore parse error */
      }
      throw new Error(
        `API request failed (${response.status} ${response.statusText}): ${
          typeof payload === "string" ? payload : JSON.stringify(payload)
        }`
      );
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  async function uploadFileRequest<T>(path: string, filePath: string, fieldName = "file"): Promise<T> {
    const context = await ensureAccessToken();
    const token = context.token;
    const scheme = context.scheme;

    if (!token) throw new Error("No access token available.");

    const formData = new FormData();
    const fileBuffer = readFileSync(filePath);
    const fileName = filePath.split('/').pop() || 'file';

    formData.append(fieldName, fileBuffer, {
      filename: fileName,
      contentType: 'application/octet-stream' // Let the server determine the content type
    });

    const headers = new Headers();
    headers.set("Authorization", `${scheme} ${token}`);

    const response = await fetchImpl(new URL(path, baseUrl), {
      method: "POST",
      headers,
      body: formData
    });

    const text = await response.text();
    if (!response.ok) {
      let payload: any = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        /* ignore parse error */
      }
      throw new Error(
        `API request failed (${response.status} ${response.statusText}): ${
          typeof payload === "string" ? payload : JSON.stringify(payload)
        }`
      );
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    get: (path, init) => request(path, { ...init, method: "GET" }),
    post: (path, body, init) =>
      request(path, { ...init, method: "POST", body: JSON.stringify(body) }),
    patch: (path, body, init) =>
      request(path, { ...init, method: "PATCH", body: JSON.stringify(body) }),
    delete: (path, init) => request(path, { ...init, method: "DELETE" }),
    uploadFile: uploadFileRequest,
    setLegacyToken(token, scheme = "Bearer") {
      legacyToken = { token, scheme };
      tokenStore.clearTokens();
    },
    clearToken() {
      legacyToken = { scheme: "Bearer" };
      tokenStore.clearTokens();
    },
    async refresh() {
      const tokens = tokenStore.getTokens();
      if (!tokens.refreshToken) throw new Error("No refresh token available.");
      await refreshWith(tokens.refreshToken);
    },
    storeOAuthTokens(payload: OAuthTokenPayload) {
      legacyToken = { scheme: "Bearer" };
      persistTokens(payload);
    }
  };
}
