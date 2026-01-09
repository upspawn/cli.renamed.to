---
layout: default
title: Commands
---

# Command Reference

Complete reference for all renamed.to CLI commands.

---

## Authentication

### `renamed auth login`

Authenticate using OAuth device flow (recommended).

```bash
renamed auth login [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--client-id <id>` | OAuth client ID | Built-in public client |
| `--client-secret <secret>` | OAuth client secret | None |
| `--base-url <url>` | OAuth server URL | `https://www.renamed.to` |
| `--scope <scope>` | Requested permissions | `read write upload process` |
| `--no-open` | Don't auto-open browser | Auto-opens |

**Example:**

```bash
renamed auth login
# Opens browser to complete authentication
```

---

### `renamed auth token`

Store an API token manually.

```bash
renamed auth token [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-t, --token <token>` | API token to store |
| `-s, --scheme <scheme>` | Authorization scheme (default: Bearer) |
| `--non-interactive` | Fail instead of prompting for input |

**Example:**

```bash
renamed auth token --token sk_live_abc123...
```

---

### `renamed auth logout`

Remove stored credentials.

```bash
renamed auth logout
```

---

### `renamed auth whoami`

Display current authenticated user.

```bash
renamed auth whoami
```

**Output:**

```
ID: user_abc123
Email: user@example.com
Name: John Doe
```

---

## File Renaming

### `renamed rename`

Get AI-powered filename suggestions.

```bash
renamed rename <files...> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `files` | One or more files to rename |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-a, --apply` | Apply suggested names | Preview only |
| `-o, --output-dir <dir>` | Output directory (uses AI folder structure) | Same directory |
| `-p, --prompt <instruction>` | Custom AI instruction for filename format | None |
| `-s, --strategy <name>` | Folder organization strategy | None |
| `-t, --template <name>` | Predefined filename template | None |
| `-l, --language <code>` | Output language code (en, de, fr, es, ...) | None |
| `--overwrite` | Overwrite existing files | Respect --on-conflict |

**Strategies (`--strategy`):**

| Strategy | Description |
|----------|-------------|
| `by_date` | Organize by year/month (2024/January/) |
| `by_issuer` | Organize by company/sender |
| `by_type` | Organize by document type (Invoices/, Contracts/) |
| `by_date_issuer` | Combine date and issuer |
| `by_date_type` | Combine date and type |
| `by_issuer_type` | Combine issuer and type |
| `by_all` | Full hierarchy (date/issuer/type) |
| `root` | No folders, flat structure |
| `follow_custom_prompt` | Use folders from --prompt instruction |

**Templates (`--template`):**

| Template | Description |
|----------|-------------|
| `standard` | Balanced format with key info |
| `date_first` | Date at start: 2024-01-15_Invoice_Acme.pdf |
| `company_first` | Company at start: Acme_Invoice_2024-01-15.pdf |
| `minimal` | Short names, essential info only |
| `detailed` | Comprehensive with all metadata |
| `department_focus` | Organized by department/category |

**Examples:**

```bash
# Preview suggestions
renamed rename invoice.pdf
# Output: invoice.pdf → 2024-01-15_Acme_Invoice_001.pdf

# Apply suggestions
renamed rename --apply invoice.pdf

# Batch processing
renamed rename *.pdf *.jpg

# Custom naming instruction
renamed rename -p "Format: YYYY-MM-DD_CompanyName_Type" invoice.pdf

# Organize into date-based folders
renamed rename -s by_date -o ~/Documents -a invoice.pdf

# Use predefined template
renamed rename -t date_first -a *.pdf

# Output in German
renamed rename -l de -a rechnung.pdf
```

**Supported files:** PDF, JPG, JPEG, PNG, TIFF (max 25MB)

---

## Document Extraction

### `renamed extract`

Extract structured data from documents.

```bash
renamed extract <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `file` | Document to extract data from |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --schema <json>` | Inline JSON schema defining fields | Auto-discovery |
| `-f, --schema-file <path>` | Path to JSON schema file | None |
| `-p, --parser-id <id>` | UUID of saved parser template | None |
| `-i, --instructions <text>` | Document-level context for AI | None |
| `-o, --output <format>` | Output format: `json` or `table` | `table` |

**Extraction Modes:**

| Mode | Description |
|------|-------------|
| **Discovery** | No schema - AI auto-detects fields |
| **Schema** | Define exact fields via `--schema` or `--schema-file` |
| **Parser** | Use saved template via `--parser-id` |

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

**Field types:** `string`, `number`, `date`, `currency`, `boolean`

**Examples:**

```bash
# Auto-discover and extract all fields
renamed extract invoice.pdf

# Output as JSON
renamed extract invoice.pdf -o json

# Extract specific fields with inline schema
renamed extract invoice.pdf -s '{"fields":[{"name":"total","type":"currency"}]}'

# Use schema from file
renamed extract invoice.pdf -f schema.json

# Provide context for better accuracy
renamed extract invoice.pdf -i "This is a German invoice"

# Use saved parser template
renamed extract invoice.pdf -p abc123-def456
```

---

## PDF Splitting

### `renamed pdf-split`

Split PDF documents using AI or rules.

```bash
renamed pdf-split <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `file` | PDF file to split |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-m, --mode <mode>` | Split mode | `smart` |
| `-i, --instructions <text>` | AI instructions | None |
| `-n, --pages-per-split <n>` | Pages per chunk | Required for `every-n-pages` |
| `-o, --output-dir <dir>` | Output directory | Current directory |
| `-w, --wait` | Wait and download files | Returns job ID only |

**Split modes:**

| Mode | Description |
|------|-------------|
| `smart` | AI analyzes content to find natural boundaries |
| `every-n-pages` | Split at fixed page intervals |
| `by-bookmarks` | Split at PDF bookmark boundaries |

**Examples:**

```bash
# AI-powered splitting (wait for results)
renamed pdf-split document.pdf --wait

# With AI instructions
renamed pdf-split invoices.pdf --wait \
  --instructions "Split by invoice number"

# Fixed intervals
renamed pdf-split book.pdf --wait \
  --mode every-n-pages \
  --pages-per-split 10

# By bookmarks
renamed pdf-split manual.pdf --wait \
  --mode by-bookmarks

# Custom output directory
renamed pdf-split doc.pdf --wait \
  --output-dir ./split-output

# Async (returns job ID for polling)
renamed pdf-split large.pdf
# Job ID: job_abc123
# Status URL: https://...
```

**Limits:** Max 100MB file size

---

## Watch Mode

### `renamed watch`

Watch directories and auto-organize files using AI.

```bash
renamed watch <directory> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `directory` | Directory to watch for new files |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --patterns <glob...>` | File patterns to process | `*.pdf *.jpg *.png` |
| `-o, --output-dir <dir>` | Base output directory | Watch directory |
| `-f, --failed-dir <dir>` | Directory for failed files | `.failed/` |
| `-n, --dry-run` | Preview without moving files | false |
| `--concurrency <n>` | Parallel processing (1-10) | 2 |
| `-c, --config <path>` | Config file path | Auto-detected |

**Examples:**

```bash
# Watch Downloads, organize into Documents
renamed watch ~/Downloads -o ~/Documents/organized

# Only process PDFs and JPGs
renamed watch ~/incoming -p "*.pdf" "*.jpg"

# Preview without moving files
renamed watch ~/inbox --dry-run

# Process 5 files in parallel
renamed watch ~/inbox --concurrency 5

# Use config file
renamed watch ~/inbox -c ~/.renamed/watch.yaml

# Custom output and failed directories
renamed watch ~/scans -o ~/Documents -f ~/failed

# Stream NDJSON events for scripting
renamed watch ~/inbox --json
```

---

## Configuration

### `renamed config init`

Create an example configuration file.

```bash
renamed config init [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-g, --global` | Create system-wide config at /etc/renamed/ |

---

### `renamed config validate`

Validate configuration files.

```bash
renamed config validate [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Specific config file to validate |

---

### `renamed config show`

Display effective configuration.

```bash
renamed config show [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Specific config file to use |

---

### `renamed config path`

Show configuration file locations.

```bash
renamed config path
```

---

### Configuration File Schema

Configuration files use YAML format. Location precedence:
1. CLI flags (highest)
2. User config: `~/.config/renamed/config.yaml`
3. System config: `/etc/renamed/config.yaml`
4. Built-in defaults (lowest)

**Complete Schema:**

```yaml
# Watch mode settings
watch:
  # File patterns to process
  patterns:
    - "*.pdf"
    - "*.jpg"
    - "*.jpeg"
    - "*.png"
    - "*.tiff"
    - "*.tif"

  # Default directories (optional)
  # outputDir: "/path/to/organized"
  # failedDir: "/path/to/failed"

# Rate limiting and processing
rateLimit:
  # Maximum concurrent file processing (1-10)
  concurrency: 2

  # Debounce delay for batch file drops (ms, 100-60000)
  debounceMs: 1000

  # Number of retry attempts for failed files (0-10)
  retryAttempts: 3

  # Base delay between retries in ms (1000-300000)
  retryDelayMs: 5000

# Health check settings
health:
  # Enable Unix socket health endpoint
  enabled: true

  # Socket path for health checks
  socketPath: "/tmp/renamed-health.sock"

# Logging configuration
logging:
  # Log level: debug, info, warn, error
  level: info

  # Output JSON logs (recommended for production)
  json: false
```

---

## Diagnostics

### `renamed doctor`

Check system configuration and connectivity.

```bash
renamed doctor [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--verbose` | Show detailed diagnostic information |

**What it checks:**

- Node.js version compatibility
- Network connectivity to renamed.to
- Authentication status and token expiry
- Configuration file validity

**Examples:**

```bash
renamed doctor              # Run all checks
renamed doctor --verbose    # Show detailed info
renamed doctor --json       # Output as JSON
```

---

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--json` | Output results as JSON (machine-readable) |
| `-q, --quiet` | Suppress progress indicators and spinners |
| `-y, --yes` | Skip confirmation prompts (auto-confirm) |
| `--no-input` | Fail instead of prompting (CI mode) |
| `--timeout <ms>` | Request timeout in milliseconds (default: 30000) |
| `--retry <count>` | Retry attempts for failed requests (default: 2) |
| `--on-conflict <strategy>` | Handle file conflicts: `fail`, `skip`, or `suffix` |
| `-h, --help` | Show help |
| `-V, --version` | Show version |

**Examples:**

```bash
# Machine-readable output
renamed rename invoice.pdf --json

# CI/CD pipeline (no prompts, fail on conflicts)
renamed rename --apply *.pdf --no-input --on-conflict fail

# Quiet mode for cron jobs
renamed watch ~/incoming -o ~/organized --quiet
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RENAMED_TOKEN` | API token for authentication (overrides keychain) |
| `RENAMED_CLIENT_ID` | Custom OAuth client ID |
| `RENAMED_CLIENT_SECRET` | OAuth client secret (confidential clients) |
| `RENAMED_JSON=1` | Enable JSON output mode |
| `RENAMED_QUIET=1` | Enable quiet mode |
| `CI=1` | Enable non-interactive mode (same as `--no-input`) |

---

[Back to Home](./)
