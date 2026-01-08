---
layout: default
title: Commands
---

# Command Reference

Complete reference for all renamed.to CLI commands.

---

## Authentication

### `renamed auth device`

Authenticate using OAuth device flow.

```bash
renamed auth device [options]
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
renamed auth device
# Visit https://www.renamed.to/device and enter code ABCD-1234
```

---

### `renamed auth login`

Store an API token.

```bash
renamed auth login [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--token <token>` | API token to store |

**Example:**

```bash
renamed auth login --token sk_live_abc123...
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

**Examples:**

```bash
# Preview suggestions
renamed rename invoice.pdf
# Output: invoice.pdf → 2024-01-15_Acme_Invoice_001.pdf

# Apply suggestions
renamed rename --apply invoice.pdf

# Batch processing
renamed rename *.pdf *.jpg

# Apply all
renamed rename --apply ~/Downloads/*
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
| `-s, --schema <type>` | Extraction schema | `invoice` |
| `-f, --fields <list>` | Custom fields (comma-separated) | Schema default |
| `-o, --output <format>` | Output format | `json` |

**Schema types:**

| Schema | Fields |
|--------|--------|
| `invoice` | vendor, invoice_number, date, due_date, total, line_items |
| `receipt` | merchant, date, total, items, payment_method |
| `contract` | parties, effective_date, terms, signatures |
| `resume` | name, email, phone, experience, education, skills |
| `custom` | User-defined via `--fields` |

**Output formats:** `json`, `table`, `csv`

**Examples:**

```bash
# Extract invoice data as JSON
renamed extract invoice.pdf --schema invoice

# Extract as table
renamed extract invoice.pdf --schema invoice --output table

# Custom fields
renamed extract document.pdf --schema custom --fields "name,date,amount,notes"

# Receipt to CSV
renamed extract receipt.jpg --schema receipt --output csv
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

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help |
| `-V, --version` | Show version |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RENAMED_API_TOKEN` | API token for authentication |
| `RENAMED_CLIENT_ID` | Custom OAuth client ID |
| `RENAMED_CLIENT_SECRET` | OAuth client secret |

---

[Back to Home](./)
