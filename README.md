# renamed.to CLI

A modern CLI tool for AI-powered file renaming, document extraction, and PDF splitting using the [renamed.to](https://renamed.to) service.

## Features

- **AI-Powered Renaming** - Intelligently rename files based on content analysis
- **Document Extraction** - Extract structured data from invoices, receipts, contracts
- **PDF Splitting** - Split multi-page PDFs using AI or rule-based methods
- **OAuth Device Flow** - Simple authentication without secrets
- **Batch Processing** - Process multiple files at once
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
   renamed auth device
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
renamed auth device           # OAuth device flow (recommended)
renamed auth login --token X  # Use API token
renamed auth logout           # Remove stored credentials
renamed auth whoami           # Show current user
```

The device flow uses a built-in public client ID, so no configuration needed.

### File Renaming

```bash
renamed rename <files...> [options]
```

| Option | Description |
|--------|-------------|
| `-a, --apply` | Automatically apply suggested names |

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RENAMED_API_TOKEN` | API token for authentication |
| `RENAMED_CLIENT_ID` | Custom OAuth client ID |
| `RENAMED_CLIENT_SECRET` | OAuth client secret (confidential clients) |

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
