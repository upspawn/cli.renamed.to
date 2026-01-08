import { Command } from "commander";
import pkg from "../package.json" assert { type: "json" };
import { createApiClient } from "./lib/api-client.js";
import { registerAuthCommands } from "./modules/auth.js";
import { registerRenameCommands } from "./modules/rename.js";
import { registerExtractCommands } from "./modules/extract.js";
import { registerPdfSplitCommands } from "./modules/pdf-split.js";
import { registerWatchCommands } from "./modules/watch.js";
import { registerConfigCommands } from "./modules/config-cmd.js";

export async function main(argv = process.argv): Promise<void> {
  const program = new Command()
    .name("renamed")
    .description("Official renamed.to CLI")
    .version(pkg.version);

  const api = createApiClient();

  registerAuthCommands(program, api);
  registerRenameCommands(program, api);
  registerExtractCommands(program, api);
  registerPdfSplitCommands(program, api);
  registerWatchCommands(program, api);
  registerConfigCommands(program);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

void main();
