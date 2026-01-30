/**
 * Version check utilities for update notifications
 */

import Conf from "conf";
import pkg from "../../package.json" assert { type: "json" };

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// npm registry URL
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@renamed-to/cli/latest";

export type InstallMethod = "npm" | "pnpm" | "homebrew" | "binary" | "unknown";

export interface VersionCache {
  latestVersion?: string;
  checkedAt?: number;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  installMethod: InstallMethod;
  updateCommand: string;
}

/**
 * Store for caching version check results
 */
export class VersionCheckStore {
  private readonly conf: Conf<VersionCache>;

  constructor() {
    this.conf = new Conf<VersionCache>({
      projectName: "renamed-cli",
      configName: "version-cache",
    });
  }

  getCache(): VersionCache {
    return {
      latestVersion: this.conf.get("latestVersion"),
      checkedAt: this.conf.get("checkedAt"),
    };
  }

  setCache(version: string): void {
    this.conf.set("latestVersion", version);
    this.conf.set("checkedAt", Date.now());
  }

  isStale(): boolean {
    const checkedAt = this.conf.get("checkedAt");
    if (!checkedAt) return true;
    return Date.now() - checkedAt > CACHE_TTL_MS;
  }

  clearCache(): void {
    this.conf.clear();
  }
}

/**
 * Detect how the CLI was installed
 */
export function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath.toLowerCase();
  const argv0 = process.argv[0]?.toLowerCase() || "";

  // Check for Homebrew installation
  if (
    execPath.includes("/opt/homebrew/") ||
    execPath.includes("/usr/local/cellar/") ||
    execPath.includes("/home/linuxbrew/")
  ) {
    return "homebrew";
  }

  // Check for npm/pnpm (running via node)
  if (execPath.endsWith("/node") || execPath.endsWith("node.exe")) {
    // Try to detect pnpm vs npm
    const scriptPath = process.argv[1] || "";
    if (scriptPath.includes("/pnpm/") || scriptPath.includes("\\.pnpm\\")) {
      return "pnpm";
    }
    return "npm";
  }

  // Check for Bun-compiled binary (no node in path)
  if (
    execPath.includes("/bun") ||
    (!execPath.includes("node") && !argv0.includes("node"))
  ) {
    return "binary";
  }

  return "unknown";
}

/**
 * Get the appropriate update command for the installation method
 */
export function getUpdateCommand(method: InstallMethod): string {
  switch (method) {
    case "npm":
      return "npm update -g @renamed-to/cli";
    case "pnpm":
      return "pnpm update -g @renamed-to/cli";
    case "homebrew":
      return "brew upgrade renamed";
    case "binary":
      return "Download from https://github.com/renamed-to/cli.renamed.to/releases";
    default:
      return "npm update -g @renamed-to/cli";
  }
}

/**
 * Get current CLI version
 */
export function getCurrentVersion(): string {
  return pkg.version;
}

/**
 * Fetch latest version from npm registry
 */
export async function fetchLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as { version: string };
    return data.version;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare semantic versions
 * Returns true if latestVersion is newer than currentVersion
 */
export function isNewerVersion(
  currentVersion: string,
  latestVersion: string
): boolean {
  const current = currentVersion.split(".").map(Number);
  const latest = latestVersion.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const c = current[i] || 0;
    const l = latest[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Check for updates, using cache when available
 * Returns UpdateInfo if an update is available, null otherwise
 */
export async function checkForUpdate(
  store: VersionCheckStore = new VersionCheckStore()
): Promise<UpdateInfo | null> {
  const currentVersion = getCurrentVersion();
  let latestVersion: string;

  // Check cache first
  if (!store.isStale()) {
    const cache = store.getCache();
    if (cache.latestVersion) {
      latestVersion = cache.latestVersion;
    } else {
      return null;
    }
  } else {
    // Fetch from registry
    try {
      latestVersion = await fetchLatestVersion();
      store.setCache(latestVersion);
    } catch {
      // Silently fail - don't interrupt user workflow
      return null;
    }
  }

  // Compare versions
  if (!isNewerVersion(currentVersion, latestVersion)) {
    return null;
  }

  const installMethod = detectInstallMethod();
  return {
    currentVersion,
    latestVersion,
    installMethod,
    updateCommand: getUpdateCommand(installMethod),
  };
}

/**
 * Silently check for updates (catches all errors)
 * Use this for the footer notification
 */
export async function checkForUpdateQuietly(): Promise<UpdateInfo | null> {
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}
