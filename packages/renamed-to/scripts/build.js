#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Create dist directory
mkdirSync(`${__dirname}/../dist`, { recursive: true });

// Create a simple re-export wrapper
const content = `#!/usr/bin/env node
// This is an alias package for @renamed-to/cli
// It simply re-exports the main CLI package
import '@renamed-to/cli';
`;

writeFileSync(`${__dirname}/../dist/index.js`, content);
console.log("✓ Built renamed-to alias package");
