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

### Homebrew (macOS/Linux) - Recommended

```bash
brew tap renamed-to/cli
brew install renamed
```

### npm

```bash
npm install -g @renamed-to/cli
```

### pnpm

```bash
pnpm add -g @renamed-to/cli
```

## Updating

Check for updates and see upgrade instructions for your installation method:

```bash
renamed update
```

Or update directly:

| Method | Command |
|--------|---------|
| Homebrew | `brew upgrade renamed` |
| npm | `npm update -g @renamed-to/cli` |
| pnpm | `pnpm update -g @renamed-to/cli` |

The CLI will show a subtle notification when updates are available.

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
   renamed extract invoice.pdf
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

#### `auth login` options

| Option | Description |
|--------|-------------|
| `--client-id <id>` | OAuth client ID (default: built-in public client) |
| `--client-secret <secret>` | OAuth client secret (for confidential clients) |
| `--base-url <url>` | OAuth base URL (default: https://www.renamed.to) |
| `--scope <scope>` | Requested scope (default: read write upload process) |
| `--no-open` | Don't automatically open browser (copy URL manually) |

#### `auth token` options

| Option | Description |
|--------|-------------|
| `-t, --token <token>` | Personal API token |
| `-s, --scheme <scheme>` | Authorization scheme (default: Bearer) |
| `--non-interactive` | Fail instead of prompting for input |

### File Renaming

```bash
renamed rename <files...> [options]
```

| Option | Description |
|--------|-------------|
| `-a, --apply` | Automatically apply suggested names |
| `-o, --output-dir <dir>` | Base directory for organized output (uses AI folder suggestions) |
| `-p, --prompt <instruction>` | Custom AI instruction for filename format |
| `-s, --strategy <name>` | Folder organization strategy (see below) |
| `-t, --template <name>` | Predefined filename template (see below) |
| `-l, --language <code>` | Output language code (en, de, fr, es, ...) |
| `--overwrite` | Overwrite existing files without prompting |

**Strategies (`--strategy`):**
- `by_date` - Organize by year/month (2024/January/)
- `by_issuer` - Organize by company/sender
- `by_type` - Organize by document type (Invoices/, Contracts/)
- `by_date_issuer` - Combine date and issuer
- `by_date_type` - Combine date and type
- `by_issuer_type` - Combine issuer and type
- `by_all` - Full hierarchy (date/issuer/type)
- `root` - No folders, flat structure
- `follow_custom_prompt` - Use folders from --prompt instruction

**Templates (`--template`):**
- `standard` - Balanced format with key info
- `date_first` - Date at start: 2024-01-15_Invoice_Acme.pdf
- `company_first` - Company at start: Acme_Invoice_2024-01-15.pdf
- `minimal` - Short names, essential info only
- `detailed` - Comprehensive with all metadata
- `department_focus` - Organized by department/category

**Examples:**
```bash
# Get suggestions
renamed rename screenshot.png
# Output: screenshot.png → 2024-01-15_product-mockup.png

# Apply automatically
renamed rename --apply *.pdf

# Batch process
renamed rename ~/Downloads/*.jpg

# Custom naming instruction
renamed rename -p "Format: YYYY-MM-DD_CompanyName_Type" invoice.pdf

# Organize into date-based folders
renamed rename -s by_date -o ~/Documents -a invoice.pdf

# Use predefined template
renamed rename -t date_first -a *.pdf

# Output in German
renamed rename -l de -a rechnung.pdf
```

### Document Extraction

```bash
renamed extract <file> [options]
```

| Option | Description |
|--------|-------------|
| `-s, --schema <json>` | Inline JSON schema defining fields to extract |
| `-f, --schema-file <path>` | Path to JSON file containing extraction schema |
| `-p, --parser-id <id>` | UUID of a saved parser template |
| `-i, --instructions <text>` | Document-level context for AI extraction |
| `-o, --output <format>` | Output format: json or table (default: table) |

**Extraction Modes:**
- **Discovery** - No schema provided; AI auto-detects fields
- **Schema** - Define exact fields via `--schema` or `--schema-file`
- **Parser** - Use saved template via `--parser-id`

**Schema Format:**
```json
{
  "fields": [
    { "name": "invoice_number", "type": "string" },
    { "name": "total", "type": "currency" },
    { "name": "due_date", "type": "date" }
  ]
}
```

Field types: `string`, `number`, `date`, `currency`, `boolean`

**Examples:**
```bash
# Auto-discover and extract all fields
renamed extract invoice.pdf

# Output as JSON for scripting/piping
renamed extract invoice.pdf -o json

# Extract specific fields with inline schema
renamed extract invoice.pdf -s '{"fields":[{"name":"total","type":"currency"}]}'

# Use schema from file
renamed extract invoice.pdf -f schema.json

# Provide context to improve extraction accuracy
renamed extract invoice.pdf -i "This is a German invoice"

# Use saved parser template
renamed extract invoice.pdf -p abc123-def456
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
| `--poll` | Use polling instead of native fs events (for Docker/NFS) |
| `--poll-interval <ms>` | Polling interval in ms (default: 500) |
| `-c, --config <path>` | Config file path |

**Examples:**
```bash
# Watch Downloads folder, organize into ~/Documents/organized
renamed watch ~/Downloads --output-dir ~/Documents/organized

# Dry run - see what would happen
renamed watch ~/incoming --output-dir ~/organized --dry-run

# With failed directory
renamed watch /var/inbox --output-dir /var/organized --failed-dir /var/failed

# Docker or NFS mounted volumes (use polling)
renamed watch /data --output-dir /output --poll
renamed watch /data --poll --poll-interval 1000
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
renamed config validate -c FILE  # Validate specific config file
renamed config show              # Display effective configuration
renamed config show -c FILE      # Show config from specific file
renamed config path              # Show config file locations
```

| Subcommand | Option | Description |
|------------|--------|-------------|
| `init` | `-g, --global` | Create system-wide config at /etc/renamed/ |
| `validate` | `-c, --config <path>` | Specific config file to validate |
| `show` | `-c, --config <path>` | Specific config file to use |

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

### Updates

Check for CLI updates:

```bash
renamed update              # Check for updates and show upgrade instructions
renamed update --check      # Only check, don't show instructions
renamed update --json       # Machine-readable output
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
git clone https://github.com/renamed-to/cli.renamed.to.git
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
