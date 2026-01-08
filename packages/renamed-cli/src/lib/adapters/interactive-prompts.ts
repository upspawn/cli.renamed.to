import prompts from "prompts";
import type { PromptService } from "../ports/prompt.js";

/**
 * Real prompt service using the 'prompts' package.
 */
export const interactivePrompts: PromptService = {
  async confirm(message: string, initial = true): Promise<boolean> {
    const { value } = await prompts({
      type: "confirm",
      name: "value",
      message,
      initial,
    });
    return value ?? false;
  },

  async password(message: string): Promise<string | undefined> {
    const { value } = await prompts({
      type: "password",
      name: "value",
      message,
    });
    return value;
  },
};
