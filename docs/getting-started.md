---
layout: default
title: Getting Started
---

# Getting Started

This guide will help you install and configure the renamed.to CLI.

## Prerequisites

- **Node.js 20** or later
- A [renamed.to](https://renamed.to) account

## Installation

Install globally using npm:

```bash
npm install -g @renamed-to/cli
```

Or with pnpm:

```bash
pnpm add -g @renamed-to/cli
```

Or with yarn:

```bash
yarn global add @renamed-to/cli
```

Verify installation:

```bash
renamed --version
```

## Authentication

The CLI supports multiple authentication methods.

### OAuth Device Flow (Recommended)

The simplest way to authenticate:

```bash
renamed auth device
```

This will:
1. Display a code and URL
2. Open your browser automatically
3. Complete authentication when you approve

No API keys or secrets needed - the CLI has a built-in public client ID.

### API Token

For automation or CI/CD pipelines:

```bash
renamed auth login --token YOUR_API_TOKEN
```

Get your API token from [renamed.to/settings/api](https://renamed.to/settings/api).

### Environment Variables

Set credentials via environment variables:

```bash
export RENAMED_API_TOKEN=your-token-here
```

## Your First Command

### Rename a File

```bash
renamed rename document.pdf
```

Output:
```
document.pdf → 2024-01-15_Meeting_Notes_Q1_Planning.pdf
Use --apply to rename the file
```

To apply the suggestion:

```bash
renamed rename document.pdf --apply
```

### Extract Data

```bash
renamed extract invoice.pdf --schema invoice
```

Output:
```json
{
  "vendor": "Acme Corp",
  "invoice_number": "INV-2024-001",
  "date": "2024-01-15",
  "total": 1234.56,
  "currency": "USD"
}
```

### Split a PDF

```bash
renamed pdf-split multi-page.pdf --wait
```

Output:
```
✔ Processing complete
  Documents created: 3
Downloaded files:
  + ./document-001.pdf (pages 1-3)
  + ./document-002.pdf (pages 4-6)
  + ./document-003.pdf (pages 7-9)
```

## Next Steps

- Learn all [available commands](./commands)
- Read the [API documentation](https://renamed.to/docs/api-docs)
- [Report issues](https://github.com/upspawn/cli.renamed.to/issues) on GitHub

---

[Back to Home](./)
