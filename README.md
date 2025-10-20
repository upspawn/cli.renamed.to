# renamed.to CLI

A modern CLI tool for AI-powered file renaming using the renamed.to service.

## Features

- 🤖 AI-powered filename suggestions
- 🔐 Multiple authentication methods (API tokens + OAuth device flow)
- 📁 Batch file processing
- ⚡ Fast uploads with progress feedback
- 🛡️ Secure token storage
- 🔄 Automatic token refresh

## Installation

```bash
npm install -g @renamed-to/cli
```

Or with yarn:

```bash
yarn global add @renamed-to/cli
```

## Quick Start

1. **Authenticate** with your renamed.to account:
   ```bash
   renamed auth login
   ```

2. **Rename files** using AI suggestions:
   ```bash
   renamed rename photo.jpg document.pdf
   ```

3. **Apply suggestions automatically**:
   ```bash
   renamed rename --apply *.jpg
   ```

## Authentication

### API Token (Recommended)

```bash
renamed auth login --token your-api-token-here
```

### Interactive Login

```bash
renamed auth login
```

### OAuth Device Flow

```bash
renamed auth device --client-id your-client-id
```

### Environment Variables

Set these for automated workflows:

```bash
export RENAMED_CLIENT_ID=your-client-id
export RENAMED_CLIENT_SECRET=your-client-secret
```

## Commands

### Authentication

```bash
renamed auth login [options]    # Store API token
renamed auth logout            # Remove stored credentials
renamed auth whoami            # Show current user
renamed auth device [options]  # OAuth device authorization
```

### File Renaming

```bash
renamed rename <files...> [options]
```

Options:
- `-a, --apply`: Automatically apply suggested filenames
- Files up to 25MB supported

## Examples

**Single file suggestion:**
```bash
renamed rename screenshot.png
# Output: screenshot.png → product-mockup-design.png
```

**Batch processing:**
```bash
renamed rename *.jpg *.png
```

**Apply all suggestions:**
```bash
renamed rename --apply ~/Downloads/*
```

**Check current user:**
```bash
renamed auth whoami
# ID: user123
# Email: user@example.com
# Name: John Doe
```

## Development

This is a monorepo using pnpm workspaces and Turbo.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Development mode
pnpm dev

# Lint code
pnpm lint
```

### Project Structure

- `packages/renamed-cli/` - Main CLI application
- `apps/` - Additional applications (if any)
- `tools/` - Development tools

## License

See individual package licenses.
