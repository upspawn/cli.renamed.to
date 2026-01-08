import { readFileSync } from "fs";
import { extname, basename } from "path";
import Conf from "conf";
import {
  notAuthenticated,
  tokenExpired,
  refreshFailed,
  networkOffline,
  networkTimeout,
  fromHttpStatus,
} from "./errors/catalog.js";

// Map file extensions to MIME types
const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

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
  fetchImpl?: typeof globalThis.fetch;
}

export interface OAuthTokenPayload {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

export interface MultipartField {
  name: string;
  value: string | number | boolean;
}

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
  uploadFile<T>(path: string, filePath: string, fieldName?: string): Promise<T>;
  uploadFileWithFields<T>(
    path: string,
    filePath: string,
    fields: MultipartField[],
    fieldName?: string
  ): Promise<T>;
  setLegacyToken(token: string, scheme?: string): void;
  clearToken(): void;
  refresh(): Promise<void>;
  storeOAuthTokens(payload: OAuthTokenPayload): void;
}

// Helper to check if a path is an absolute URL
function isAbsoluteUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}

export function createApiClient({
  baseUrl = "https://www.renamed.to/api/v1",
  oauthBaseUrl = "https://www.renamed.to",
  clientId = process.env.RENAMED_CLIENT_ID,
  clientSecret = process.env.RENAMED_CLIENT_SECRET,
  tokenStore = new ConfTokenStore(),
  fetchImpl = globalThis.fetch
}: ApiClientOptions = {}): ApiClient {
  let legacyToken: { token?: string; scheme: string } = { scheme: "Bearer" };

  async function ensureAccessToken() {
    if (legacyToken.token) return legacyToken;

    const tokens = tokenStore.getTokens();
    if (!tokens.accessToken) {
      throw notAuthenticated();
    }

    if (tokens.expiresAt && tokens.expiresAt > Date.now() + 30_000) {
      return {
        token: tokens.accessToken,
        scheme: tokens.tokenType ?? "Bearer"
      };
    }

    if (!tokens.refreshToken) {
      throw tokenExpired();
    }

    await refreshWith(tokens.refreshToken);
    const next = tokenStore.getTokens();
    return {
      token: next.accessToken,
      scheme: next.tokenType ?? "Bearer"
    };
  }

  async function refreshWith(refreshToken: string) {
    if (!clientId) throw refreshFailed("RENAMED_CLIENT_ID is required to refresh tokens.");

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
    const tokens: StoredTokens = {
      accessToken: payload.access_token,
      tokenType: payload.token_type ?? "Bearer"
    };

    // Only set optional fields if they have values (conf doesn't allow undefined)
    if (payload.refresh_token) {
      tokens.refreshToken = payload.refresh_token;
    }
    if (payload.scope) {
      tokens.scope = payload.scope;
    }
    if (payload.expires_in) {
      tokens.expiresAt = Date.now() + payload.expires_in * 1000;
    }

    tokenStore.setTokens(tokens);
  }

  async function fetchJson(url: string, body: unknown) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      // Network error
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw networkOffline();
      }
      throw error;
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      throw fromHttpStatus(res.status, res.statusText, data);
    }

    return data;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const context = await ensureAccessToken();
    const token = context.token;
    const scheme = context.scheme;

    if (!token) throw notAuthenticated();

    const headers = new Headers(init.headers as HeadersInit | undefined);
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
    headers.set("Authorization", `${scheme} ${token}`);

    // Handle absolute URLs (e.g., statusUrl from API responses) or construct relative URLs
    let url: string;
    if (isAbsoluteUrl(path)) {
      url = path;
    } else {
      url = path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers
      });
    } catch (error) {
      // Network error
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw networkOffline();
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw networkTimeout();
      }
      throw error;
    }

    const text = await response.text();
    if (!response.ok) {
      let payload: unknown = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        /* ignore parse error */
      }
      throw fromHttpStatus(response.status, response.statusText, payload);
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  async function uploadFileRequest<T>(path: string, filePath: string, fieldName = "file"): Promise<T> {
    const context = await ensureAccessToken();
    const token = context.token;
    const scheme = context.scheme;

    if (!token) throw notAuthenticated();

    const fileBuffer = readFileSync(filePath);
    const fileName = basename(filePath);
    const mimeType = getMimeType(filePath);

    // Use native FormData and Blob (Node 18+)
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append(fieldName, blob, fileName);

    // Handle absolute URLs or construct relative URLs
    let url: string;
    if (isAbsoluteUrl(path)) {
      url = path;
    } else {
      url = path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `${scheme} ${token}`
        },
        body: formData
      });
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw networkOffline();
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw networkTimeout();
      }
      throw error;
    }

    const text = await response.text();
    if (!response.ok) {
      let payload: unknown = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        /* ignore parse error */
      }
      throw fromHttpStatus(response.status, response.statusText, payload);
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  async function uploadFileWithFieldsRequest<T>(
    path: string,
    filePath: string,
    fields: MultipartField[],
    fieldName = "file"
  ): Promise<T> {
    const context = await ensureAccessToken();
    const token = context.token;
    const scheme = context.scheme;

    if (!token) throw notAuthenticated();

    const fileBuffer = readFileSync(filePath);
    const fileName = basename(filePath);
    const mimeType = getMimeType(filePath);

    // Use native FormData and Blob (Node 18+)
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append(fieldName, blob, fileName);

    for (const field of fields) {
      formData.append(field.name, String(field.value));
    }

    // Handle absolute URLs or construct relative URLs
    let url: string;
    if (isAbsoluteUrl(path)) {
      url = path;
    } else {
      url = path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `${scheme} ${token}`
        },
        body: formData
      });
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw networkOffline();
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw networkTimeout();
      }
      throw error;
    }

    const text = await response.text();
    if (!response.ok) {
      let payload: unknown = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        /* ignore parse error */
      }
      throw fromHttpStatus(response.status, response.statusText, payload);
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
    uploadFileWithFields: uploadFileWithFieldsRequest,
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
      if (!tokens.refreshToken) throw tokenExpired();
      await refreshWith(tokens.refreshToken);
    },
    storeOAuthTokens(payload: OAuthTokenPayload) {
      legacyToken = { scheme: "Bearer" };
      persistTokens(payload);
    }
  };
}
