---
layout: default
title: Getting Started
---

# Getting Started

This guide will help you install and configure the renamed.to CLI.

## Prerequisites

- **Node.js 20** or later
- A [renamed.to](https://www.renamed.to) account

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
renamed auth login
```

This will:
1. Display a URL and code
2. Open your browser automatically
3. Complete authentication when you approve

No API keys or secrets needed - the CLI has a built-in public client ID.

### API Token

For automation or CI/CD pipelines:

```bash
renamed auth token --token YOUR_API_TOKEN
```

Get your API token from [www.renamed.to/settings/api](https://www.renamed.to/settings/api).

### Environment Variables

Set credentials via environment variables:

```bash
export RENAMED_TOKEN=your-token-here
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
renamed extract invoice.pdf
```

Output:
```
Extracted Fields:
┌─────────────────┬──────────────────────────┬────────────┐
│ Field           │ Value                    │ Confidence │
├─────────────────┼──────────────────────────┼────────────┤
│ vendor          │ Acme Corp                │ 98%        │
│ invoice_number  │ INV-2024-001             │ 99%        │
│ date            │ 2024-01-15               │ 97%        │
│ total           │ $1,234.56                │ 98%        │
└─────────────────┴──────────────────────────┴────────────┘
```

For JSON output:

```bash
renamed extract invoice.pdf -o json
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

## Check Your Setup

Run diagnostics to verify everything is configured correctly:

```bash
renamed doctor
```

Output:
```
Diagnostics Report
──────────────────────────────────────────────────
✓ Node.js version: Node.js v20.10.0
✓ Network connectivity: Connected to https://www.renamed.to (150ms)
✓ Authentication: Authenticated
✓ Token validation: Token is valid

System Information:
  OS: darwin 23.0.0
  Node.js: v20.10.0
  CLI: v1.2.0
  API: https://www.renamed.to

✓ All 4 checks passed
```

## Next Steps

- Learn all [available commands](./commands)
- Set up [watch mode](./commands#watch-mode) for automatic file organization
- Configure [persistent settings](./commands#configuration-file-schema) via YAML config
- Read the [API documentation](https://www.renamed.to/docs/api-docs)
- [Report issues](https://github.com/renamed-to/cli.renamed.to/issues) on GitHub

---

[Back to Home](./)
