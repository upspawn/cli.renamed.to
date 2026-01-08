/**
 * Abstraction for browser operations.
 * Allows testing without opening actual browsers.
 */
export interface BrowserService {
  /** Open a URL in the system's default browser */
  open(url: string): Promise<void>;
}
