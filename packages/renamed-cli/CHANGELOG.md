# @renamed-to/cli

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
