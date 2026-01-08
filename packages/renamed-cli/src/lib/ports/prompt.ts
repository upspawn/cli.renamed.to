/**
 * Abstraction for user prompts.
 * Allows testing interactive flows without actual user input.
 */
export interface PromptService {
  /** Ask user for confirmation */
  confirm(message: string, initial?: boolean): Promise<boolean>;
  /** Ask user for password/secret input */
  password(message: string): Promise<string | undefined>;
}
