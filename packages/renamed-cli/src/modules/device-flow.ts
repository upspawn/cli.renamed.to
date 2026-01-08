import ora from "ora";
import chalk from "chalk";
import open from "open";
import prompts from "prompts";

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

export async function requestDeviceCode(config: DeviceAuthConfig): Promise<DeviceCodeResponse> {
  const res = await fetchJson(`${config.baseUrl}/api/oauth/device`, {
    client_id: config.clientId,
    scope: config.scope
  });

  return {
    ...res,
    interval: res.interval ?? config.pollInterval
  };
}

export async function pollForTokens(
  config: DeviceAuthConfig,
  device: DeviceCodeResponse
): Promise<TokenResponse> {
  const baseInterval = device.interval ?? config.pollInterval;
  let interval = baseInterval;
  const deadline = Date.now() + device.expires_in * 1000;

  while (Date.now() < deadline) {
    await delay(interval * 1000);

    const tokenBody: Record<string, string> = {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: config.clientId,
      device_code: device.device_code
    };

    // Only include client_secret if provided (confidential clients require it)
    if (config.clientSecret) {
      tokenBody.client_secret = config.clientSecret;
    }

    const res = await fetch(`${config.baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenBody)
    });

    const data = await res.json();
    if (res.ok) return data;

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

export async function runDeviceAuth(config: DeviceAuthConfig) {
  const spinner = ora("Requesting device code").start();
  const device = await requestDeviceCode(config);
  spinner.succeed("Device code issued");

  const message = `Visit ${device.verification_uri} and enter code ${device.user_code}`;
  console.log(chalk.cyan(message));

  if (config.openBrowser) {
    await open(device.verification_uri_complete, { wait: false });
  } else {
    const { launch } = await prompts({
      type: "confirm",
      name: "launch",
      message: "Open the verification URL in your browser?",
      initial: true
    });

    if (launch) {
      await open(device.verification_uri_complete, { wait: false });
    }
  }

  const pollSpinner = ora("Waiting for authorization").start();
  const tokens = await pollForTokens(config, device);
  pollSpinner.succeed("Authorization complete");
  return tokens;
}

async function fetchJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description ?? data.error ?? res.statusText);
  }
  return data;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
