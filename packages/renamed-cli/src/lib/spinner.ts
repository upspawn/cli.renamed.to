/**
 * Spinner wrapper that respects quiet/JSON mode.
 * Provides a consistent interface for progress indication.
 */

import ora, { type Ora } from "ora";
import { isQuietMode, isJsonMode } from "./cli-context.js";

export interface Spinner {
  start(text?: string): Spinner;
  stop(): Spinner;
  succeed(text?: string): Spinner;
  fail(text?: string): Spinner;
  warn(text?: string): Spinner;
  info(text?: string): Spinner;
  text: string;
  isSpinning: boolean;
}

/**
 * No-op spinner for quiet/JSON mode.
 */
class SilentSpinner implements Spinner {
  text = "";
  isSpinning = false;

  start(_text?: string): Spinner {
    return this;
  }

  stop(): Spinner {
    return this;
  }

  succeed(_text?: string): Spinner {
    return this;
  }

  fail(_text?: string): Spinner {
    return this;
  }

  warn(_text?: string): Spinner {
    return this;
  }

  info(_text?: string): Spinner {
    return this;
  }
}

/**
 * Wrapper around ora that respects quiet mode.
 */
class OraSpinner implements Spinner {
  private ora: Ora;

  constructor(text?: string) {
    this.ora = ora(text);
  }

  get text(): string {
    return this.ora.text;
  }

  set text(value: string) {
    this.ora.text = value;
  }

  get isSpinning(): boolean {
    return this.ora.isSpinning;
  }

  start(text?: string): Spinner {
    this.ora.start(text);
    return this;
  }

  stop(): Spinner {
    this.ora.stop();
    return this;
  }

  succeed(text?: string): Spinner {
    this.ora.succeed(text);
    return this;
  }

  fail(text?: string): Spinner {
    this.ora.fail(text);
    return this;
  }

  warn(text?: string): Spinner {
    this.ora.warn(text);
    return this;
  }

  info(text?: string): Spinner {
    this.ora.info(text);
    return this;
  }
}

/**
 * Create a spinner that respects quiet/JSON mode.
 */
export function createSpinner(text?: string): Spinner {
  if (isQuietMode() || isJsonMode()) {
    return new SilentSpinner();
  }
  return new OraSpinner(text);
}

/**
 * Log to stderr only if not in JSON mode.
 * Use this for progress messages that shouldn't pollute JSON output.
 */
export function logProgress(message: string): void {
  if (!isJsonMode()) {
    console.error(message);
  }
}
