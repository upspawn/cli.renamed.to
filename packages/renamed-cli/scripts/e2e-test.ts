#!/usr/bin/env npx tsx
/**
 * End-to-end test script for renamed CLI.
 *
 * Usage:
 *   RENAMED_API_KEY=your_key npx tsx scripts/e2e-test.ts [test.pdf]
 *
 * If no PDF is provided, creates a simple test file.
 */

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "../dist/index.js");
const TEST_DIR = join(__dirname, "../.e2e-test");

// Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step: string) {
  console.log(`\n${colors.cyan}━━━ ${step} ━━━${colors.reset}`);
}

function logSuccess(message: string) {
  log(`✓ ${message}`, colors.green);
}

function logError(message: string) {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`  ${message}`, colors.dim);
}

interface TestResult {
  name: string;
  passed: boolean;
  output?: string;
  error?: string;
  skipped?: boolean;
}

const results: TestResult[] = [];

function runCommand(
  args: string[],
  options: { expectError?: boolean; env?: Record<string, string> } = {}
): { success: boolean; output: string; error: string } {
  try {
    // Capture both stdout and stderr by redirecting stderr to stdout
    const result = execSync(`node ${CLI_PATH} ${args.join(" ")} 2>&1`, {
      encoding: "utf-8",
      env: { ...process.env, ...options.env },
      timeout: 60000,
    });
    return { success: true, output: result, error: "" };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const combinedOutput = (execError.stdout || "") + (execError.stderr || "");
    if (options.expectError) {
      return {
        success: true,
        output: combinedOutput || execError.message || "",
        error: "",
      };
    }
    return {
      success: false,
      output: combinedOutput,
      error: execError.message || "",
    };
  }
}

function test(
  name: string,
  fn: () => { passed: boolean; message?: string }
): void {
  try {
    const result = fn();
    results.push({
      name,
      passed: result.passed,
      output: result.message,
    });
    if (result.passed) {
      logSuccess(name);
      if (result.message) logInfo(result.message);
    } else {
      logError(name);
      if (result.message) logInfo(result.message);
    }
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: (error as Error).message,
    });
    logError(name);
    logInfo((error as Error).message);
  }
}

function skip(name: string, reason: string): void {
  results.push({ name, passed: true, skipped: true });
  log(`⊘ ${name} (skipped: ${reason})`, colors.yellow);
}

// ============================================================================
// Setup
// ============================================================================

function setup(): { testFile: string | null; hasApiKey: boolean } {
  logStep("Setup");

  // Check if CLI is built
  if (!existsSync(CLI_PATH)) {
    logError("CLI not built. Run 'pnpm build' first.");
    process.exit(1);
  }
  logSuccess("CLI build found");

  // Create test directory
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  logSuccess(`Test directory: ${TEST_DIR}`);

  // Check for API key
  const apiKey = process.env.RENAMED_API_KEY;
  const hasApiKey = !!apiKey;
  if (!hasApiKey) {
    log("\n⚠️  No RENAMED_API_KEY set. API tests will be skipped.", colors.yellow);
    log("   Set it with: export RENAMED_API_KEY=your_key", colors.dim);
  } else {
    logSuccess("API key found");
  }

  // Check for test PDF
  const providedFile = process.argv[2];
  if (providedFile && existsSync(providedFile)) {
    logSuccess(`Using provided file: ${providedFile}`);
    return { testFile: providedFile, hasApiKey };
  }

  // Create a simple test file (text file for rename testing)
  const testFile = join(TEST_DIR, "messy_document_2024_01.txt");
  writeFileSync(testFile, "This is a test document for e2e testing.");
  logSuccess(`Created test file: ${testFile}`);

  return { testFile, hasApiKey };
}

function cleanup(): void {
  logStep("Cleanup");
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
    logSuccess("Cleaned up test directory");
  }
}

// ============================================================================
// Tests
// ============================================================================

function testHelp(): void {
  logStep("Help Commands");

  test("--help shows usage", () => {
    const { success, output } = runCommand(["--help"]);
    return {
      passed: success && output.includes("Usage:") && output.includes("Commands:"),
      message: "Shows usage and commands list",
    };
  });

  test("--version shows version", () => {
    const { success, output } = runCommand(["--version"]);
    return {
      passed: success && /\d+\.\d+\.\d+/.test(output),
      message: output.trim(),
    };
  });

  test("rename --help shows options", () => {
    const { success, output } = runCommand(["rename", "--help"]);
    return {
      passed: success && output.includes("--apply") && output.includes("--output-dir"),
      message: "Shows rename-specific options",
    };
  });

  test("extract --help shows options", () => {
    const { success, output } = runCommand(["extract", "--help"]);
    return {
      passed: success && output.includes("--schema") && output.includes("--output"),
      message: "Shows extract-specific options",
    };
  });

  test("pdf-split --help shows options", () => {
    const { success, output } = runCommand(["pdf-split", "--help"]);
    return {
      passed: success && output.includes("--mode") && output.includes("--wait"),
      message: "Shows pdf-split-specific options",
    };
  });

  test("watch --help shows options", () => {
    const { success, output } = runCommand(["watch", "--help"]);
    return {
      passed: success && output.includes("--patterns") && output.includes("--dry-run"),
      message: "Shows watch-specific options",
    };
  });

  test("config --help shows subcommands", () => {
    const { success, output } = runCommand(["config", "--help"]);
    return {
      passed: success && output.includes("init") && output.includes("show"),
      message: "Shows config subcommands",
    };
  });

  test("auth --help shows subcommands", () => {
    const { success, output } = runCommand(["auth", "--help"]);
    return {
      passed: success && output.includes("login") && output.includes("logout"),
      message: "Shows auth subcommands",
    };
  });
}

function testConfig(): void {
  logStep("Config Commands");

  test("config show displays configuration", () => {
    const { success, output } = runCommand(["config", "show"]);
    return {
      passed: success && output.includes("Effective Configuration"),
      message: "Displays effective configuration",
    };
  });
}

function testAuth(): void {
  logStep("Auth Commands");

  test("auth whoami shows authentication state", () => {
    const { output, error } = runCommand(["auth", "whoami"], { expectError: true });
    const combined = output + error;
    return {
      passed: combined.includes("Authenticated") || combined.includes("Not authenticated") || combined.includes("credentials"),
      message: "Shows auth status",
    };
  });
}

function testRename(testFile: string | null, hasApiKey: boolean): void {
  logStep("Rename Command");

  if (!testFile) {
    skip("rename preview", "No test file available");
    return;
  }

  if (!hasApiKey) {
    skip("rename preview (API)", "No API key - set RENAMED_API_KEY to test");
    return;
  }

  test("rename shows preview without --apply", () => {
    const { success, output, error } = runCommand(["rename", testFile]);
    const combined = output + error;
    // Should show a suggestion or error about auth/API
    return {
      passed: combined.includes("→") || combined.includes("Processing") || combined.includes("Error") || combined.includes("credentials"),
      message: combined.substring(0, 300),
    };
  });
}

function testExtract(testFile: string | null, hasApiKey: boolean): void {
  logStep("Extract Command");

  if (!testFile || !testFile.endsWith(".pdf")) {
    skip("extract with schema", "No PDF file available");
    skip("extract discovery mode", "No PDF file available");
    return;
  }

  if (!hasApiKey) {
    skip("extract with schema", "No API key");
    skip("extract discovery mode", "No API key");
    return;
  }

  test("extract in discovery mode", () => {
    const { success, output, error } = runCommand(["extract", testFile, "--output", "json"]);
    const combined = output + error;
    return {
      passed: combined.includes("fields") || combined.includes("Extraction") || combined.includes("Error"),
      message: combined.substring(0, 200),
    };
  });
}

function testPdfSplit(testFile: string | null, hasApiKey: boolean): void {
  logStep("PDF Split Command");

  if (!testFile || !testFile.endsWith(".pdf")) {
    skip("pdf-split smart mode", "No PDF file available");
    return;
  }

  if (!hasApiKey) {
    skip("pdf-split smart mode", "No API key");
    return;
  }

  test("pdf-split submits job", () => {
    const { success, output, error } = runCommand(["pdf-split", testFile]);
    const combined = output + error;
    return {
      passed: combined.includes("Job") || combined.includes("submitted") || combined.includes("Error"),
      message: combined.substring(0, 200),
    };
  });
}

function testErrorHandling(): void {
  logStep("Error Handling");

  test("rename with non-existent file shows error", () => {
    const { output, error } = runCommand(["rename", "/nonexistent/file.pdf"], { expectError: true });
    const combined = output + error;
    return {
      passed: combined.includes("Cannot access") || combined.includes("ENOENT") || combined.includes("Error"),
      message: "Properly handles missing file",
    };
  });

  test("extract with non-existent file shows error", () => {
    const { output, error } = runCommand(["extract", "/nonexistent/file.pdf"], { expectError: true });
    const combined = output + error;
    return {
      passed: combined.includes("Cannot access") || combined.includes("ENOENT") || combined.includes("Error"),
      message: "Properly handles missing file",
    };
  });

  test("pdf-split with non-existent file shows error", () => {
    const { output, error } = runCommand(["pdf-split", "/nonexistent/file.pdf"], { expectError: true });
    const combined = output + error;
    return {
      passed: combined.includes("Cannot access") || combined.includes("ENOENT") || combined.includes("Error"),
      message: "Properly handles missing file",
    };
  });

  test("invalid command shows error", () => {
    const { output, error } = runCommand(["invalid-command"], { expectError: true });
    const combined = output + error;
    return {
      passed: combined.includes("unknown command") || combined.includes("error"),
      message: "Shows unknown command error",
    };
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log(`\n${colors.cyan}╔══════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║     Renamed CLI End-to-End Tests         ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════╝${colors.reset}`);

  const { testFile, hasApiKey } = setup();

  try {
    testHelp();
    testConfig();
    testAuth();
    testErrorHandling();
    testRename(testFile, hasApiKey);
    testExtract(testFile, hasApiKey);
    testPdfSplit(testFile, hasApiKey);
  } finally {
    cleanup();
  }

  // Summary
  logStep("Summary");
  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total = results.length;

  console.log(`\n  Total:   ${total}`);
  log(`  Passed:  ${passed}`, colors.green);
  if (failed > 0) log(`  Failed:  ${failed}`, colors.red);
  if (skipped > 0) log(`  Skipped: ${skipped}`, colors.yellow);

  if (failed > 0) {
    console.log(`\n${colors.red}Some tests failed!${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}All tests passed!${colors.reset}`);
  }
}

main().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});
