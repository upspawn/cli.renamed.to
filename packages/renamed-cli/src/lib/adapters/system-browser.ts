import type { BrowserService } from "../ports/browser.js";

/**
 * Real browser service using the 'open' package.
 */
export const systemBrowser: BrowserService = {
  async open(url: string): Promise<void> {
    const openModule = await import("open");
    await openModule.default(url, { wait: false });
  },
};
