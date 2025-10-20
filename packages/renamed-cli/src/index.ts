import { Command } from "commander";
import pkg from "../package.json" assert { type: "json" };
import { createApiClient } from "./lib/api-client.js";
import { registerAuthCommands } from "./modules/auth.js";
import { registerRenameCommands } from "./modules/rename.js";

export async function main(argv = process.argv): Promise<void> {
  const program = new Command()
    .name("renamed")
    .description("Official renamed.to CLI")
    .version(pkg.version);

  const api = createApiClient();

  registerAuthCommands(program, api);
  registerRenameCommands(program, api);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

void main();
