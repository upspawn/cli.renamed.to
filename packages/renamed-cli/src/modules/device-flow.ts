import ora from "ora";
import chalk from "chalk";
import type { BrowserService } from "../lib/ports/browser.js";
import type { PromptService } from "../lib/ports/prompt.js";
import type { DelayFn } from "../lib/ports/timer.js";
import { systemBrowser } from "../lib/adapters/system-browser.js";
import { interactivePrompts } from "../lib/adapters/interactive-prompts.js";
import { realDelay } from "../lib/adapters/real-timers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

export interface DeviceAuthConfig {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  scope: string;
  pollInterval: number;
  openBrowser: boolean;
}

/**
 * Dependencies for device auth flow.
 * All have sensible defaults for production use.
 */
export interface DeviceAuthDeps {
  fetchImpl?: typeof fetch;
  browserService?: BrowserService;
  promptService?: PromptService;
  delay?: DelayFn;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data as { error_description?: string; error?: string }).error_description ??
        (data as { error?: string }).error ??
        res.statusText
    );
  }
  return data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Request a device code from the authorization server.
 */
export async function requestDeviceCode(
  config: DeviceAuthConfig,
  deps: DeviceAuthDeps = {}
): Promise<DeviceCodeResponse> {
  const { fetchImpl = globalThis.fetch } = deps;

  const res = await fetchJson(
    `${config.baseUrl}/api/oauth/device`,
    {
      client_id: config.clientId,
      scope: config.scope,
    },
    fetchImpl
  );

  return {
    device_code: res.device_code as string,
    user_code: res.user_code as string,
    verification_uri: res.verification_uri as string,
    verification_uri_complete: res.verification_uri_complete as string,
    expires_in: res.expires_in as number,
    interval: (res.interval as number) ?? config.pollInterval,
  };
}

/**
 * Poll the token endpoint until authorization is complete.
 */
export async function pollForTokens(
  config: DeviceAuthConfig,
  device: DeviceCodeResponse,
  deps: DeviceAuthDeps = {}
): Promise<TokenResponse> {
  const { fetchImpl = globalThis.fetch, delay = realDelay } = deps;

  const baseInterval = device.interval ?? config.pollInterval;
  let interval = baseInterval;
  const deadline = Date.now() + device.expires_in * 1000;

  while (Date.now() < deadline) {
    await delay(interval * 1000);

    const tokenBody: Record<string, string> = {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: config.clientId,
      device_code: device.device_code,
    };

    if (config.clientSecret) {
      tokenBody.client_secret = config.clientSecret;
    }

    const res = await fetchImpl(`${config.baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenBody),
    });

    const data = (await res.json()) as {
      error?: string;
      error_description?: string;
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
    };

    if (res.ok) {
      return data as TokenResponse;
    }

    switch (data.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5;
        break;
      case "access_denied":
        throw new Error("Authorization denied by user.");
      case "expired_token":
        throw new Error("Device code expired. Please start again.");
      default:
        throw new Error(data.error_description ?? data.error ?? "Unknown error.");
    }
  }

  throw new Error("Authorization timed out. Please start again.");
}

/**
 * Run the complete device authorization flow.
 */
export async function runDeviceAuth(
  config: DeviceAuthConfig,
  deps: DeviceAuthDeps = {}
): Promise<TokenResponse> {
  const {
    fetchImpl = globalThis.fetch,
    browserService = systemBrowser,
    promptService = interactivePrompts,
    delay = realDelay,
  } = deps;

  const spinner = ora("Requesting device code").start();
  const device = await requestDeviceCode(config, { fetchImpl });
  spinner.succeed("Device code issued");

  const message = `Visit ${device.verification_uri} and enter code ${device.user_code}`;
  console.log(chalk.cyan(message));

  if (config.openBrowser) {
    await browserService.open(device.verification_uri_complete);
  } else {
    const shouldOpen = await promptService.confirm(
      "Open the verification URL in your browser?",
      true
    );

    if (shouldOpen) {
      await browserService.open(device.verification_uri_complete);
    }
  }

  const pollSpinner = ora("Waiting for authorization").start();
  const tokens = await pollForTokens(config, device, { fetchImpl, delay });
  pollSpinner.succeed("Authorization complete");

  return tokens;
}
