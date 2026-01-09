# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the official CLI for renamed.to - an AI-powered file renaming, document extraction, and PDF splitting service. The main package is `@renamed-to/cli` in `packages/renamed-cli/`.

## Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm build            # Build all packages (uses turbo)
pnpm test             # Run all tests
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint

# Run single test file
cd packages/renamed-cli && npx vitest run src/modules/rename.test.ts

# Run tests matching pattern
cd packages/renamed-cli && npx vitest run -t "handles API errors"

# Run CLI locally
node packages/renamed-cli/dist/index.js <command>
```

Pre-commit hooks run `typecheck` and `test` automatically.

## Architecture

### Entry Point and Command Registration

`src/index.ts` is the CLI entry point. It uses Commander.js and registers commands from `src/modules/`:
- `auth.ts` - OAuth device flow (`login`) and manual token (`token`)
- `rename.ts` - AI-powered file renaming
- `extract.ts` - Structured data extraction from documents
- `pdf-split.ts` - PDF splitting (AI or rule-based)
- `watch.ts` - Directory watching with auto-processing
- `doctor.ts` - System diagnostics
- `config-cmd.ts` - Configuration management

### Ports and Adapters Pattern

The codebase uses dependency injection for testability:

- **Ports** (`src/lib/ports/`) - Interfaces for external dependencies (timers, browser, file watcher, signals, downloads)
- **Adapters** (`src/lib/adapters/`) - Real implementations (chokidar, process signals, fetch)

Functions accept optional `deps` parameters with defaults for production:
```typescript
export async function pollJobStatus(
  api: ApiClient,
  statusUrl: string,
  deps: PdfSplitDeps = {},  // Optional deps with defaults
  onProgress?: (status: JobStatusResponse) => void
): Promise<JobStatusResponse> {
  const { delay = realDelay } = deps;
  // ...
}
```

### API Client

`src/lib/api-client.ts` handles all renamed.to API communication:
- OAuth token storage via `conf` (stored in OS config directory)
- Automatic token refresh
- File uploads with multipart form data
- Typed error handling

### Error System

`src/lib/errors/` provides structured CLI errors:
- `types.ts` - `CLIError` class with codes, suggestions, examples
- `catalog.ts` - Factory functions for common errors (auth, network, validation)
- `renderer.ts` - Human-friendly error formatting

### Global CLI Context

`src/lib/cli-context.ts` manages global options (`--json`, `--quiet`, `--yes`, `--no-input`, `--timeout`, `--retry`, `--on-conflict`) parsed once at startup and accessible throughout.

### JSON Output

`src/lib/json-output.ts` defines JSON schemas for machine-readable output. Commands check `isJsonMode()` and output structured data via `outputSuccess()` or `outputNdjson()` for streaming.

## Testing Patterns

Tests use Vitest with extensive mocking. When testing modules that use external dependencies:

```typescript
// Mock before imports
vi.mock("../lib/spinner.js", () => ({
  createSpinner: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })
}));

vi.mock("../lib/cli-context.js", () => ({
  isJsonMode: () => false,
  isNonInteractive: () => false
}));
```

Commander commands are tested by creating a program with `exitOverride()` and calling `parseAsync()`.

## CLI UX Standards

### Error Messages
- Always include actionable suggestions in errors (use `CLIError` with `suggestion` field)
- Show example commands when arguments are missing
- Link to docs for complex issues (`docs` field)
- Use `chalk.red` for errors, `chalk.yellow` for warnings, `chalk.cyan` for info

### Exit Codes
- `0` - Success, help displayed, or version displayed
- `1` - Any error (validation, network, auth, etc.)
- Never exit non-zero for expected behaviors like `--help`

### Command Help
Each command should have `.addHelpText("after", ...)` with:
- Section headers using `chalk.bold.cyan("Section:")`
- Examples with descriptions in `chalk.gray`
- Related commands or tips

### Output Modes
- Human-readable (default): Spinners, colors, formatted tables
- `--json`: Structured JSON for scripting (no spinners, no colors)
- `--quiet`: Suppress progress, only final output
- Watch mode with `--json`: NDJSON streaming (one JSON object per line)

### First-Run Experience
- Running `renamed` with no args shows welcome message with quick start
- `renamed doctor` validates setup (auth, network, versions)
- Auth commands guide users to signup URL

## Documentation Standards

### README.md
Update `packages/renamed-cli/README.md` when:
- Adding new commands or options
- Changing command names or behavior
- Adding environment variables

### Command Help Text
- Keep examples practical and copy-pasteable
- Show common workflows, not just syntax
- Use consistent formatting across commands

### Changelog
Maintained via changesets (see Release Workflow below)

## Backward Compatibility

### Breaking Changes
- Renaming commands requires a major version bump
- Changing default behavior requires a major version bump
- Removing options requires deprecation notice first

### Deprecation Process
1. Add deprecation warning in current version
2. Document migration path in help text
3. Remove in next major version

### JSON Output Contract
- `--json` output schemas in `src/lib/json-output.ts` are part of public API
- Adding fields is non-breaking
- Removing or renaming fields requires major version bump
- Test JSON output in tests to catch accidental changes

### Config File Compatibility
- New config options should have sensible defaults
- Never remove config options without deprecation cycle

## Release Workflow

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and GitHub Actions for automated publishing. **Never publish locally** - all releases go through CI/CD.

### How It Works

1. When PRs with changesets are merged to `main`, GitHub Actions automatically creates/updates a **Release PR** titled "Version Packages"
2. The Release PR accumulates all pending changesets and shows the version bump + changelog
3. When the Release PR is merged, GitHub Actions automatically publishes to npm

### Step-by-Step Release Process

#### 1. Create a changeset with your changes
```bash
npx changeset
# Select: @renamed-to/cli
# Select: patch/minor/major
# Write description from user perspective
```
This creates a file like `.changeset/fuzzy-lions-dance.md`

#### 2. Commit everything together
```bash
git add .
git commit -m "feat: your feature description"
```

#### 3. Push and create PR
```bash
git push origin your-feature-branch
# Create PR on GitHub, get it reviewed and merged
```

#### 4. Wait for Release PR (automatic)
After your PR merges to `main`, GitHub Actions will:
- Detect the new changeset
- Create/update a PR titled **"Version Packages"**
- This PR contains the version bump and CHANGELOG updates

#### 5. Merge the Release PR
When ready to release, merge the "Version Packages" PR. GitHub Actions will:
- Build and test
- Publish to npm with provenance
- Create a GitHub Release

### Quick Reference
```bash
# Development workflow:
npx changeset                    # Create changeset
git add . && git commit          # Commit with changeset
git push && gh pr create         # Create PR

# After PR merges: wait for "Version Packages" PR, then merge it to release
```

### Version Bump Guidelines
- **patch**: Bug fixes, documentation, dependency updates, internal refactors
- **minor**: New features, new commands, new options (backward compatible)
- **major**: Breaking changes to commands, options, or JSON output

### Changeset Message Format
Write from user perspective:
```
Added `--timeout` flag to control request timeouts
Fixed exit code when `--help` is passed
Improved error messages for authentication failures
```

### Pre-Release Checklist
Before merging the "Version Packages" PR:
- [ ] All CI checks pass (typecheck, test, lint)
- [ ] README.md updated if commands/options changed
- [ ] `docs/` folder updated if commands/options changed
- [ ] Changeset describes user-visible changes
- [ ] CHANGELOG.md preview looks correct

### Troubleshooting

**No Release PR created?**
- Check that your PR included a `.changeset/*.md` file
- The workflow only triggers on changes to `.changeset/**` or `packages/**`

**Release failed?**
- Check GitHub Actions logs
- Ensure `NPM_TOKEN` secret is set in repository settings
- Verify npm package permissions

## PR Workflow

### Before Submitting
1. Run `pnpm typecheck` and `pnpm test`
2. Update README.md if adding/changing commands
3. Create changeset if user-facing changes
4. Test manually: `node packages/renamed-cli/dist/index.js <command>`

### PR Description
- Describe the "why" not just "what"
- Link to issues if applicable
- Include example command output for UX changes

### Review Checklist
- [ ] Tests pass and cover new code paths
- [ ] Error messages are helpful with suggestions
- [ ] `--json` output follows existing schema patterns
- [ ] Help text is clear with examples
- [ ] No breaking changes without major version bump intent
- [ ] Changeset created for user-facing changes

## Coding Standards

### TypeScript
- Strict mode enabled (`"strict": true`) - no `any` types, null checks required
- Explicit return types on exported functions
- Use `interface` for object shapes, `type` for unions/intersections
- Prefer `unknown` over `any` for truly unknown types

### Function Design
- Pure functions where possible - extract logic from I/O
- Single responsibility - one function, one job
- Small functions (<30 lines) - extract helpers when growing
- Early returns to reduce nesting

```typescript
// Good: Pure validation, early returns
export function validateFilePath(filePath: string): void {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw new Error(`Cannot access file: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds limit: ${filePath}`);
  }
}
```

### Dependency Injection
- External dependencies (fs, network, timers) go through ports/adapters
- Functions accept optional `deps` parameter with production defaults
- Enables testing without mocking modules

```typescript
// Good: Injectable dependencies with defaults
export function createFileHandler(
  ctx: FileHandlerContext,
  deps: WatchDeps = {}  // Optional with defaults
): (filePath: string) => void {
  const { timerService = realTimerService, fileExists = existsSync } = deps;
  // ...
}
```

### Error Handling
- Use `CLIError` for user-facing errors with helpful context
- Catch at command boundaries, not deep in call stack
- Always set `process.exitCode = 1` on errors, never `process.exit(1)`
- Include recovery suggestions in error messages

```typescript
// Good: Structured error with suggestion
throw new CLIError("AUTH_NOT_AUTHENTICATED", "Not logged in", {
  suggestion: "Run `renamed auth login` to authenticate",
  docs: "https://www.renamed.to/docs/cli/auth"
});
```

### Async/Await
- Always use async/await over raw promises
- Handle errors with try/catch at appropriate boundaries
- Use `void` prefix for fire-and-forget promises in event handlers

```typescript
// Good: void prefix for unhandled promise
process.on("SIGTERM", () => {
  void shutdown(ctx).then(() => process.exit(0));
});
```

### Testing Requirements
- Test files colocated with source (`*.test.ts` next to `*.ts`)
- Mock external dependencies, not internal modules
- Test error paths, not just happy paths
- Use descriptive test names that explain the scenario

```typescript
// Good: Descriptive test names
it("throws if non-interactive without token", async () => {
  await expect(resolveToken({ nonInteractive: true })).rejects.toThrow(/interactive/);
});

it("continues processing after individual file error", async () => {
  // Test that batch processing doesn't abort on single failure
});
```

### Code Organization
- One export per file for modules, grouped exports for utilities
- Keep related code close - command registration with its logic
- Separate formatting (pure) from I/O (impure)

```typescript
// Good: Pure formatting functions separate from I/O
export function formatCompletionSummary(
  documents: SplitDocument[],
  downloadedPaths: string[]
): string[] {
  // Pure - returns data, no console.log
}

// I/O happens at command level
for (const line of formatCompletionSummary(docs, paths)) {
  console.log(line);
}
```

### Naming Conventions
- Commands: verb-noun (`pdf-split`, `config-cmd`)
- Functions: verbObject (`createSpinner`, `validateFilePath`, `registerAuthCommands`)
- Interfaces: PascalCase nouns (`ApiClient`, `WatchContext`, `CLIError`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_FILE_SIZE_BYTES`, `POLL_INTERVAL_MS`)

### Performance
- Lazy imports for heavy dependencies in rarely-used commands
- Stream large files, don't load into memory
- Use `concurrency` option for parallel processing (default: 2)

## Security Standards

### Credential Handling
- **Never log tokens** - Not in errors, debug output, or telemetry
- **Never embed credentials** - No hardcoded tokens, keys, or secrets in code
- **Mask in output** - If showing token info, show only last 4 chars: `****abcd`
- **Memory hygiene** - Don't store credentials in long-lived variables

```typescript
// Bad: Logging credentials
console.log(`Using token: ${token}`);
logger.debug({ token, refreshToken });

// Good: Log presence, not value
console.log("Using stored credentials");
logger.debug({ hasToken: !!token, tokenType });
```

### Credential Storage
- Use `conf` library (OS-level secure storage, not plaintext files)
- Tokens stored in OS keychain on macOS, credential manager on Windows
- Clear credentials completely on logout (`clearTokens()`)
- Validate token expiry before storage - reject already-expired tokens

```typescript
// In ConfTokenStore
setTokens(tokens: StoredTokens): void {
  const now = Date.now();
  if (tokens.expiresAt && tokens.expiresAt < now) {
    throw new Error("Refusing to persist already-expired tokens.");
  }
  this.conf.set(tokens);
}
```

### Input Validation
- **File paths** - Resolve to absolute, check within expected directories
- **User input in errors** - Sanitize before displaying (no format string injection)
- **URL parameters** - Never interpolate user input into URLs without encoding
- **File sizes** - Enforce limits before processing (25MB default, 100MB for PDF split)

```typescript
// Good: Validate before processing
export function validateFilePath(filePath: string): void {
  const resolved = resolve(filePath);

  // Check file exists and is accessible
  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new Error(`Cannot access file: ${resolved}`);
  }

  // Prevent directory traversal by checking it's a file
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${resolved}`);
  }

  // Enforce size limits
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds ${MAX_FILE_SIZE_MB}MB limit`);
  }
}
```

### Network Security
- **HTTPS only** - All API calls use HTTPS, never HTTP
- **No credential leakage** - Tokens in Authorization header, never in URLs
- **Timeout enforcement** - Default 30s timeout prevents hanging
- **Certificate validation** - Never disable TLS verification

```typescript
// Good: Token in header, not URL
const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

// Bad: Token in URL (logged in server logs, browser history)
const response = await fetch(`${url}?token=${accessToken}`);
```

### OAuth Security
- **PKCE not required** - Using device flow (no redirect URI)
- **State validation** - Device code verified server-side
- **Token refresh** - Automatic refresh before expiry, secure storage of refresh tokens
- **Scope limitation** - Request minimum necessary scopes

### Error Message Security
- **No stack traces to users** - Log internally, show friendly message
- **No internal paths** - Don't expose server paths or internal structure
- **No credential hints** - Don't reveal if username exists vs wrong password
- **Sanitize file paths** - User-provided paths OK, but not internal temp paths

```typescript
// Bad: Exposes internal details
console.error(`Failed: ${error.stack}`);
console.error(`Config at /home/user/.config/renamed-cli/config.json failed`);

// Good: User-friendly, no internals
console.error(chalk.red("Configuration error. Run `renamed config validate` to check."));
logger.error("Config parse failed", { error: error.message }); // Internal log only
```

### File System Security
- **No arbitrary writes** - Only write to user-specified output directories
- **Atomic operations** - Use rename() for atomic file moves
- **Permission preservation** - Don't change file permissions unexpectedly
- **Temp file cleanup** - Clean up temporary files on success and failure

### Dependency Security
- **Minimal dependencies** - Each dep is an attack surface
- **Lock file committed** - `pnpm-lock.yaml` ensures reproducible builds
- **Regular updates** - Keep dependencies current for security patches
- **No postinstall scripts** - Avoid deps with complex install hooks

### Environment Variable Safety
- **RENAMED_TOKEN** - Accepted but not logged
- **No secret in CI logs** - Use masked variables in CI/CD
- **Precedence documented** - Env vars override config files (intentional)

```typescript
// Good: Check env without logging value
const envToken = process.env.RENAMED_TOKEN;
if (envToken) {
  logger.debug("Using token from RENAMED_TOKEN environment variable");
  return envToken;
}
```

## Key Conventions

- ESM-only (`"type": "module"` in package.json)
- Node.js 20+ required
- All imports use `.js` extension (TypeScript ESM requirement)
- Chalk for terminal colors, ora for spinners
- URLs use `www.renamed.to` (with www)
- Signup URL is `/sign-up` (with hyphen)
