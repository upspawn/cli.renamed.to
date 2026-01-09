# renamed.to CLI

A modern CLI tool for AI-powered file renaming, document extraction, and PDF splitting using the [renamed.to](https://www.renamed.to) service.

## Features

- **AI-Powered Renaming** - Intelligently rename files based on content analysis
- **AI Folder Organization** - Files automatically organized into AI-suggested folder structures
- **Document Extraction** - Extract structured data from invoices, receipts, contracts
- **PDF Splitting** - Split multi-page PDFs using AI or rule-based methods
- **Watch Mode** - Auto-process files as they arrive in watched directories
- **OAuth Device Flow** - Simple authentication without secrets
- **Batch Processing** - Process multiple files at once
- **Server Deployment** - Run as a systemd service with health checks
- **Secure Token Storage** - Credentials stored safely with automatic refresh

## Installation

```bash
npm install -g @renamed-to/cli
```

Or with pnpm:

```bash
pnpm add -g @renamed-to/cli
```

## Quick Start

1. **Authenticate** with your renamed.to account:
   ```bash
   renamed auth login
   ```
   This opens your browser to complete authentication.

2. **Rename files** using AI:
   ```bash
   renamed rename invoice.pdf receipt.jpg
   ```

3. **Extract data** from documents:
   ```bash
   renamed extract invoice.pdf --schema invoice
   ```

4. **Split PDFs** intelligently:
   ```bash
   renamed pdf-split multi-doc.pdf --wait
   ```

## Commands

### Authentication

```bash
renamed auth login            # OAuth device flow (recommended)
renamed auth token --token X  # Use API token manually
renamed auth logout           # Remove stored credentials
renamed auth whoami           # Show current user
```

The login command uses OAuth device flow with a built-in public client ID, so no configuration needed.

### File Renaming

```bash
renamed rename <files...> [options]
```

| Option | Description |
|--------|-------------|
| `-a, --apply` | Automatically apply suggested names |
| `-o, --output-dir <dir>` | Base directory for organized output (uses AI folder suggestions) |
| `--overwrite` | Overwrite existing files without prompting |

**Examples:**
```bash
# Get suggestions
renamed rename screenshot.png
# Output: screenshot.png → 2024-01-15_product-mockup.png

# Apply automatically
renamed rename --apply *.pdf

# Batch process
renamed rename ~/Downloads/*.jpg
```

### Document Extraction

```bash
renamed extract <file> [options]
```

| Option | Description |
|--------|-------------|
| `-s, --schema <type>` | Schema: invoice, receipt, contract, resume, custom |
| `-f, --fields <list>` | Comma-separated fields for custom schema |
| `-o, --output <format>` | Output: json (default), table, csv |

**Examples:**
```bash
# Extract invoice data
renamed extract invoice.pdf --schema invoice

# Custom fields
renamed extract doc.pdf --schema custom --fields "name,date,total"

# Output as CSV
renamed extract receipt.jpg --schema receipt --output csv
```

### PDF Splitting

```bash
renamed pdf-split <file> [options]
```

| Option | Description |
|--------|-------------|
| `-m, --mode <mode>` | smart (AI), every-n-pages, by-bookmarks |
| `-i, --instructions <text>` | AI instructions for smart mode |
| `-n, --pages-per-split <n>` | Pages per split (for every-n-pages) |
| `-o, --output-dir <dir>` | Output directory (default: current) |
| `-w, --wait` | Wait for completion and download files |

**Examples:**
```bash
# AI-powered splitting
renamed pdf-split merged.pdf --wait

# Split by invoice numbers
renamed pdf-split invoices.pdf -i "Split by invoice number" --wait

# Fixed page intervals
renamed pdf-split book.pdf --mode every-n-pages -n 10 --wait

# Custom output directory
renamed pdf-split doc.pdf --wait -o ./split-output
```

### Watch Mode (Server Automation)

Monitor directories and automatically organize files using AI:

```bash
renamed watch <directory> [options]
```

| Option | Description |
|--------|-------------|
| `-p, --patterns <glob...>` | File patterns (default: `*.pdf *.jpg *.png`) |
| `-o, --output-dir <dir>` | Base output directory for organized files |
| `-f, --failed-dir <dir>` | Directory for files that fail processing |
| `-n, --dry-run` | Preview without moving files |
| `--concurrency <n>` | Parallel processing (1-10, default: 2) |
| `-c, --config <path>` | Config file path |

**Examples:**
```bash
# Watch Downloads folder, organize into ~/Documents/organized
renamed watch ~/Downloads --output-dir ~/Documents/organized

# Dry run - see what would happen
renamed watch ~/incoming --output-dir ~/organized --dry-run

# With failed directory
renamed watch /var/inbox --output-dir /var/organized --failed-dir /var/failed
```

Files are organized into AI-suggested folder structures:
```
~/Documents/organized/
  invoices/
    2024/
      acme-invoice-001.pdf
  receipts/
    amazon-order-12345.pdf
```

### Configuration

Manage CLI settings with YAML config files:

```bash
renamed config init              # Create user config (~/.config/renamed/)
renamed config init --global     # Create system config (/etc/renamed/)
renamed config validate          # Validate config files
renamed config show              # Display effective configuration
renamed config path              # Show config file locations
```

Config file example (`~/.config/renamed/config.yaml`):
```yaml
watch:
  patterns: ["*.pdf", "*.jpg", "*.png"]
rateLimit:
  concurrency: 2
  retryAttempts: 3
health:
  enabled: true
  socketPath: "/tmp/renamed-health.sock"
logging:
  level: info
  json: false
```

### Diagnostics

Check system configuration and connectivity:

```bash
renamed doctor              # Run all checks
renamed doctor --verbose    # Include detailed system info
renamed doctor --json       # Machine-readable output
```

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--json` | Output results as JSON (machine-readable) |
| `-q, --quiet` | Suppress progress indicators and spinners |
| `-y, --yes` | Skip confirmation prompts (auto-confirm) |
| `--no-input` | Fail instead of prompting for input (CI mode) |
| `--timeout <ms>` | Request timeout in milliseconds (default: 30000) |
| `--retry <count>` | Number of retry attempts for failed requests (default: 2) |
| `--on-conflict <strategy>` | Handle file conflicts: `fail`, `skip`, or `suffix` |

**Examples:**
```bash
# Machine-readable output for scripting
renamed rename invoice.pdf --json

# CI/CD pipeline (no prompts, fail on conflicts)
renamed rename --apply *.pdf --no-input --on-conflict fail

# Quiet mode for cron jobs
renamed watch ~/incoming -o ~/organized --quiet

# NDJSON streaming for watch mode
renamed watch ~/Downloads --json
```

## Server Deployment

For running as a systemd service on Linux servers, see [docs/SERVER-SETUP.md](packages/renamed-cli/docs/SERVER-SETUP.md).

Quick start:
```bash
# Install service
sudo cp examples/systemd/renamed.service /etc/systemd/system/
sudo systemctl enable renamed
sudo systemctl start renamed

# Check health
echo "" | nc -U /tmp/renamed-health.sock
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RENAMED_TOKEN` | API token for authentication (overrides keychain) |
| `RENAMED_CLIENT_ID` | Custom OAuth client ID |
| `RENAMED_CLIENT_SECRET` | OAuth client secret (confidential clients) |
| `RENAMED_JSON=1` | Enable JSON output mode |
| `RENAMED_QUIET=1` | Enable quiet mode |
| `CI=1` | Enable non-interactive mode (same as `--no-input`) |

## Supported File Types

- **Documents**: PDF
- **Images**: JPG, JPEG, PNG, TIFF

Maximum file size: 100MB for PDF split, 25MB for other operations.

## Development

```bash
# Clone and install
git clone https://github.com/upspawn/cli.renamed.to.git
cd cli.renamed.to
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run with coverage
pnpm test -- --coverage
```

## License

MIT
