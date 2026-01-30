# @renamed-to/cli

## 1.2.0

### Minor Changes

- e139e3b: Added `--poll` and `--poll-interval` options to the `watch` command for environments where native filesystem events don't work (Docker bind mounts, NFS, CIFS)

## 1.1.2

### Patch Changes

- 3bcc98f: Fixed lint issues across the codebase
  - Removed unused imports in watch.ts, logger.test.ts, e2e-test.ts
  - Fixed unused variables in index.ts, rename.test.ts, e2e-test.ts
  - Prefixed unused parameters with underscore in extract.ts
  - Added coverage/\*\* to eslint ignores (generated files)

## 1.1.1

### Patch Changes

- ebb3a24: Fixed documentation to accurately reflect CLI commands and options
  - Fixed `extract` command docs (was incorrectly documenting non-existent schema types)
  - Added missing options for `rename` command (--prompt, --strategy, --template, --language)
  - Added missing options for `auth login` and `auth token` commands
  - Added documentation for `watch`, `config`, and `doctor` commands
  - Added complete configuration file schema documentation
  - Removed unused `watch.directories` from config schema
  - Fixed incorrect command names (`auth device` → `auth login`)

## 1.1.0

### Minor Changes

- 1b82599: Improved CLI UX with better error messages and documentation-style help output. Added ports/adapters pattern for better testability. Updated all dependencies to latest versions.

## 1.0.1

### Patch Changes

- e2b6e83: Add README to npm package display

## 1.0.0

### Major Changes

- f61646a: Initial public release of renamed CLI

  Includes core features:
  - AI-powered file renaming
  - PDF document extraction
  - PDF document splitting
  - Device flow authentication
  - Configuration management

### Minor Changes

- Add watch mode for automatic server-side file organization

  ### New Features
  - **Watch Mode** (`renamed watch`): Monitor directories and auto-organize files using AI-suggested folder structures
  - **Configuration Management** (`renamed config`): YAML-based configuration with init, validate, show, and path commands
  - **Health Monitoring**: Unix socket health endpoint for service monitoring
  - **Folder Organization**: Files automatically organized into AI-suggested paths (e.g., `invoices/2024/acme-invoice.pdf`)

  ### Infrastructure
  - Production-hardened systemd unit file template
  - Rate-limited processing queue with exponential backoff
  - Graceful shutdown with queue draining
  - Failed directory for files that fail processing
  - Dry-run mode for safe testing
  - Comprehensive server deployment guide with troubleshooting

  ### New Dependencies
  - `chokidar` - File system watching
  - `yaml` - YAML configuration parsing
  - `zod` - Schema validation
