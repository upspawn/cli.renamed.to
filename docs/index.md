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
$ renamed extract invoice.pdf --schema invoice --output table
┌─────────────┬──────────────────────────┐
│ Field       │ Value                    │
├─────────────┼──────────────────────────┤
│ vendor      │ Acme Corporation         │
│ invoice_no  │ INV-2024-0042            │
│ date        │ 2024-01-15               │
│ total       │ $1,234.56                │
└─────────────┴──────────────────────────┘
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
renamed auth device
```

This opens your browser to complete OAuth authentication. No API keys to manage.

### 3. Use

```bash
# Rename files
renamed rename *.pdf --apply

# Extract data
renamed extract receipt.jpg --schema receipt

# Split PDFs
renamed pdf-split document.pdf --wait
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Zero Config Auth** | OAuth device flow with built-in client ID |
| **Batch Processing** | Process multiple files in one command |
| **Multiple Outputs** | JSON, table, or CSV output formats |
| **Smart Splitting** | AI understands document boundaries |
| **Secure Storage** | Tokens stored safely with auto-refresh |

---

## Links

- [Getting Started Guide](./getting-started)
- [Command Reference](./commands)
- [API Documentation](https://renamed.to/docs/api-docs)
- [GitHub Repository](https://github.com/upspawn/cli.renamed.to)
- [Report Issues](https://github.com/upspawn/cli.renamed.to/issues)

---

<p align="center">
  <a href="https://renamed.to">renamed.to</a> · MIT License
</p>
