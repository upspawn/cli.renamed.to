---
layout: default
title: Home
---

# renamed.to CLI

**AI-powered file renaming, document extraction, and PDF splitting from your terminal.**

```bash
npm install -g @renamed-to/cli
```

---

## What can it do?

### Rename Files Intelligently

Upload any document or image and get AI-suggested filenames based on the actual content.

```bash
$ renamed rename invoice.pdf
invoice.pdf → 2024-01-15_Acme_Corp_Invoice_INV-2024-0042.pdf
```

### Extract Structured Data

Pull structured data from invoices, receipts, contracts, and more.

```bash
$ renamed extract invoice.pdf
┌─────────────────┬──────────────────────────┬────────────┐
│ Field           │ Value                    │ Confidence │
├─────────────────┼──────────────────────────┼────────────┤
│ vendor          │ Acme Corporation         │ 98%        │
│ invoice_no      │ INV-2024-0042            │ 99%        │
│ date            │ 2024-01-15               │ 97%        │
│ total           │ $1,234.56                │ 98%        │
└─────────────────┴──────────────────────────┴────────────┘
```

### Split PDFs with AI

Intelligently split multi-page PDFs based on content boundaries.

```bash
$ renamed pdf-split merged-invoices.pdf --wait
✔ Processing complete
  Documents created: 3
  + invoice-001.pdf (pages 1-2)
  + invoice-002.pdf (pages 3-4)
  + invoice-003.pdf (pages 5-6)
```

### Watch & Auto-Organize

Monitor directories and automatically organize incoming files.

```bash
$ renamed watch ~/Downloads -o ~/Documents/organized
✔ Watcher ready, monitoring for new files
```

---

## Quick Start

### 1. Install

```bash
npm install -g @renamed-to/cli
# or
pnpm add -g @renamed-to/cli
```

### 2. Authenticate

```bash
renamed auth login
```

This opens your browser to complete OAuth authentication. No API keys to manage.

### 3. Use

```bash
# Rename files
renamed rename *.pdf --apply

# Extract data
renamed extract receipt.jpg

# Split PDFs
renamed pdf-split document.pdf --wait

# Watch directories
renamed watch ~/incoming -o ~/organized
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Zero Config Auth** | OAuth device flow with built-in client ID |
| **Batch Processing** | Process multiple files in one command |
| **Watch Mode** | Auto-organize files as they arrive |
| **Smart Splitting** | AI understands document boundaries |
| **JSON Output** | Machine-readable output for scripting |
| **Secure Storage** | Tokens stored safely with auto-refresh |

---

## Links

- [Getting Started Guide](./getting-started)
- [Command Reference](./commands)
- [API Documentation](https://www.renamed.to/docs/api-docs)
- [GitHub Repository](https://github.com/renamed-to/cli.renamed.to)
- [Report Issues](https://github.com/renamed-to/cli.renamed.to/issues)

---

<p align="center">
  <a href="https://www.renamed.to">renamed.to</a> · MIT License
</p>
