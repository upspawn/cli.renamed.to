<p align="center">
  <a href="https://www.renamed.to">
    <img src="https://www.renamed.to/logo.svg" alt="renamed.to" width="120" />
  </a>
</p>

<h1 align="center">renamed.to CLI</h1>

<p align="center">
  <strong>AI-powered file renaming, document extraction, and PDF splitting from your terminal</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@renamed-to/cli"><img src="https://img.shields.io/npm/v/@renamed-to/cli?style=flat-square&color=0ea5e9" alt="npm version" /></a>
  <a href="https://github.com/renamed-to/cli.renamed.to/actions"><img src="https://img.shields.io/github/actions/workflow/status/renamed-to/cli.renamed.to/ci.yml?style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://www.renamed.to/docs/cli"><img src="https://img.shields.io/badge/docs-renamed.to-blue?style=flat-square" alt="Documentation" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" /></a>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-commands">Commands</a> •
  <a href="#-watch-mode">Watch Mode</a> •
  <a href="#-server-deployment">Server</a>
</p>

<br />

<!--
<p align="center">
  <img src="https://www.renamed.to/cli-demo.gif" alt="CLI Demo" width="600" />
</p>
-->

---

## ✨ Features

<table>
<tr>
<td width="50%">

**🤖 AI-Powered Renaming**<br/>
Intelligently rename files based on content analysis

**📁 Smart Organization**<br/>
Auto-organize files into AI-suggested folder structures

**📄 Document Extraction**<br/>
Extract structured data from invoices, receipts, contracts

</td>
<td width="50%">

**✂️ PDF Splitting**<br/>
Split multi-page PDFs using AI or rule-based methods

**👁️ Watch Mode**<br/>
Auto-process files as they arrive in watched directories

**🔐 Secure Auth**<br/>
OAuth device flow — no secrets to manage

</td>
</tr>
</table>

---

## 📦 Installation

<table>
<tr>
<td><strong>npm</strong></td>
<td><strong>pnpm</strong></td>
<td><strong>Homebrew</strong></td>
</tr>
<tr>
<td>

```bash
npm install -g @renamed-to/cli
```

</td>
<td>

```bash
pnpm add -g @renamed-to/cli
```

</td>
<td>

```bash
brew install renamed-to/tap/renamed
```

</td>
</tr>
</table>

---

## 🚀 Quick Start

```bash
# 1. Authenticate with your renamed.to account
renamed auth device

# 2. Rename files using AI
renamed rename invoice.pdf receipt.jpg

# 3. Extract data from documents
renamed extract invoice.pdf --schema invoice

# 4. Split PDFs intelligently
renamed pdf-split multi-doc.pdf --wait
```

<details>
<summary><strong>🎬 See it in action</strong></summary>

```
$ renamed rename screenshot.png
✔ Analyzing screenshot.png...
  screenshot.png → 2024-01-15_product-mockup.png

$ renamed rename --apply *.pdf
✔ Renamed 3 files
  invoice-scan.pdf     → 2024-01-10_acme-corp-invoice-4521.pdf
  contract.pdf         → 2024-01-08_service-agreement-clientco.pdf
  receipt-photo.pdf    → 2024-01-15_amazon-order-12345.pdf
```

</details>

---

## 📖 Commands

### 🔑 Authentication

```bash
renamed auth device           # OAuth device flow (recommended)
renamed auth login --token X  # Use API token
renamed auth logout           # Remove stored credentials
renamed auth whoami           # Show current user
```

> The device flow uses a built-in public client ID — no configuration needed.

---

### 📝 File Renaming

```bash
renamed rename <files...> [options]
```

| Option | Description |
|--------|-------------|
| `-a, --apply` | Automatically apply suggested names |
| `-o, --output-dir <dir>` | Base directory for organized output (uses AI folder suggestions) |

<details>
<summary><strong>Examples</strong></summary>

```bash
# Get suggestions
renamed rename screenshot.png

# Apply automatically
renamed rename --apply *.pdf

# Organize into folders
renamed rename --apply --output-dir ~/Documents/organized ~/Downloads/*.jpg
```

</details>

---

### 📊 Document Extraction

```bash
renamed extract <file> [options]
```

| Option | Description |
|--------|-------------|
| `-s, --schema <type>` | Schema: `invoice`, `receipt`, `contract`, `resume`, `custom` |
| `-f, --fields <list>` | Comma-separated fields for custom schema |
| `-o, --output <format>` | Output: `json` (default), `table`, `csv` |

<details>
<summary><strong>Examples</strong></summary>

```bash
# Extract invoice data
renamed extract invoice.pdf --schema invoice

# Custom fields
renamed extract doc.pdf --schema custom --fields "name,date,total"

# Output as CSV
renamed extract receipt.jpg --schema receipt --output csv
```

</details>

---

### ✂️ PDF Splitting

```bash
renamed pdf-split <file> [options]
```

| Option | Description |
|--------|-------------|
| `-m, --mode <mode>` | `smart` (AI), `every-n-pages`, `by-bookmarks` |
| `-i, --instructions <text>` | AI instructions for smart mode |
| `-n, --pages-per-split <n>` | Pages per split (for `every-n-pages`) |
| `-o, --output-dir <dir>` | Output directory |
| `-w, --wait` | Wait for completion and download files |

<details>
<summary><strong>Examples</strong></summary>

```bash
# AI-powered splitting
renamed pdf-split merged.pdf --wait

# Split by invoice numbers
renamed pdf-split invoices.pdf -i "Split by invoice number" --wait

# Fixed page intervals
renamed pdf-split book.pdf --mode every-n-pages -n 10 --wait
```

</details>

---

## 👁️ Watch Mode

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

<details>
<summary><strong>Example: Organize Downloads folder</strong></summary>

```bash
renamed watch ~/Downloads --output-dir ~/Documents/organized
```

Files are organized into AI-suggested folder structures:

```
~/Documents/organized/
├── invoices/
│   └── 2024/
│       └── acme-invoice-001.pdf
├── receipts/
│   └── amazon-order-12345.pdf
└── contracts/
    └── service-agreement.pdf
```

</details>

---

## 🖥️ Server Deployment

Run as a systemd service on Linux servers:

```bash
# Install service
sudo cp examples/systemd/renamed.service /etc/systemd/system/
sudo systemctl enable renamed
sudo systemctl start renamed

# Check health
echo "" | nc -U /tmp/renamed-health.sock
```

See [SERVER-SETUP.md](docs/SERVER-SETUP.md) for full documentation.

---

## ⚙️ Configuration

```bash
renamed config init              # Create user config
renamed config init --global     # Create system config
renamed config validate          # Validate config files
renamed config show              # Display effective configuration
```

<details>
<summary><strong>Example config file</strong></summary>

`~/.config/renamed/config.yaml`:

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

</details>

---

## 🌍 Environment Variables

| Variable | Description |
|----------|-------------|
| `RENAMED_API_TOKEN` | API token for authentication |
| `RENAMED_CLIENT_ID` | Custom OAuth client ID |
| `RENAMED_CLIENT_SECRET` | OAuth client secret (confidential clients) |

---

## 📋 Supported Files

| Type | Formats | Max Size |
|------|---------|----------|
| 📄 Documents | PDF | 100MB (split), 25MB (other) |
| 🖼️ Images | JPG, JPEG, PNG, TIFF | 25MB |

---

## 🛠️ Development

```bash
git clone https://github.com/renamed-to/cli.renamed.to.git
cd cli.renamed.to
pnpm install
pnpm build
pnpm test
```

---

<p align="center">
  <a href="https://www.renamed.to">Website</a> •
  <a href="https://www.renamed.to/docs/cli">Documentation</a> •
  <a href="https://github.com/renamed-to/cli.renamed.to/issues">Issues</a>
</p>

<p align="center">
  <sub>Built with ❤️ by the <a href="https://www.renamed.to">renamed.to</a> team</sub>
</p>
