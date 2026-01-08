# Server Setup Guide

This guide covers deploying the renamed.to CLI as a long-running service on a Linux server.

## Prerequisites

- Node.js 20+ (LTS recommended)
- systemd (standard on most Linux distributions)
- renamed.to API credentials

## Installation

### 1. Create Service User

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin renamed
```

### 2. Install the CLI

```bash
# Create installation directory
sudo mkdir -p /opt/renamed
sudo chown renamed:renamed /opt/renamed

# Install globally or locally
cd /opt/renamed
sudo -u renamed npm init -y
sudo -u renamed npm install @renamed-to/cli
```

### 3. Create Directories

```bash
# Watch inbox directory
sudo mkdir -p /var/watch/inbox /var/watch/failed /var/organized
sudo chown -R renamed:renamed /var/watch /var/organized
```

### 4. Configure Authentication

```bash
# Option A: Environment variable (recommended for servers)
# Add to /etc/systemd/system/renamed.service.d/override.conf:
# [Service]
# Environment=RENAMED_CLIENT_ID=your-client-id

# Option B: Device flow authentication (run as renamed user)
sudo -u renamed /opt/renamed/node_modules/.bin/renamed auth device
```

### 5. Create Configuration (Optional)

```bash
sudo mkdir -p /etc/renamed
sudo cp /opt/renamed/node_modules/@renamed-to/cli/examples/config/renamed.example.yaml \
    /etc/renamed/config.yaml
sudo vim /etc/renamed/config.yaml
```

### 6. Install systemd Service

```bash
sudo cp /opt/renamed/node_modules/@renamed-to/cli/examples/systemd/renamed.service \
    /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable renamed
sudo systemctl start renamed
```

## Monitoring

### View Logs

```bash
# Follow logs in real-time
journalctl -u renamed -f

# View recent logs
journalctl -u renamed --since "1 hour ago"

# View errors only
journalctl -u renamed -p err
```

### Health Checks

```bash
# Check service status
systemctl status renamed

# Query health socket (if enabled)
echo "" | nc -U /tmp/renamed-health.sock

# Example response:
# {
#   "status": "healthy",
#   "uptime": 3600,
#   "queue": {
#     "pending": 0,
#     "active": 1,
#     "completed": 150,
#     "failed": 2,
#     "totalProcessed": 152,
#     "averageLatencyMs": 2340
#   },
#   "lastProcessedAt": "2024-01-15T10:30:00.000Z",
#   "errors": 2
# }
```

### Metrics

The health endpoint provides:

| Field | Description |
|-------|-------------|
| `status` | `healthy`, `degraded`, or `unhealthy` |
| `uptime` | Seconds since service start |
| `queue.pending` | Files waiting to be processed |
| `queue.active` | Files currently being processed |
| `queue.completed` | Successfully processed files |
| `queue.failed` | Files that failed processing |
| `queue.averageLatencyMs` | Average processing time |

**Status values:**
- `healthy` - Normal operation
- `degraded` - >10% failure rate or >100 pending files
- `unhealthy` - Critical issues

## Usage

### Watch Mode

The main feature - monitors a directory and auto-organizes files:

```bash
renamed watch <directory>
  -p, --patterns <glob...>    File patterns (default: *.pdf *.jpg *.png)
  -o, --output-dir <dir>      Base output for organized files
  -f, --failed-dir <dir>      Where failed files go (default: .failed/)
  -n, --dry-run               Preview without moving files
  --concurrency <n>           Parallel processing (1-10, default: 2)
  -c, --config <path>         Config file path
```

### Configuration Management

```bash
# Create example config
renamed config init              # User config (~/.config/renamed/)
renamed config init --global     # System config (/etc/renamed/)

# Validate config files
renamed config validate

# Show effective configuration
renamed config show

# Show config file paths
renamed config path
```

## Troubleshooting

### Service Won't Start

**Symptoms:** `systemctl start renamed` fails or service exits immediately.

**Diagnosis:**
```bash
# Check logs for errors
journalctl -u renamed -n 50

# Check service status
systemctl status renamed

# Test manually as service user
sudo -u renamed /opt/renamed/node_modules/.bin/renamed watch \
    /var/watch/inbox --dry-run
```

**Common causes:**

1. **Missing authentication:**
   ```bash
   # Check if authenticated
   sudo -u renamed /opt/renamed/node_modules/.bin/renamed auth whoami

   # If not authenticated:
   sudo -u renamed /opt/renamed/node_modules/.bin/renamed auth device
   ```

2. **Permission denied on directories:**
   ```bash
   # Check ownership
   ls -la /var/watch /var/organized

   # Fix ownership
   sudo chown -R renamed:renamed /var/watch /var/organized
   ```

3. **Node.js not found:**
   ```bash
   # Check node path
   which node

   # Update ExecStart in service file if needed
   ```

4. **Invalid config file:**
   ```bash
   sudo -u renamed /opt/renamed/node_modules/.bin/renamed config validate
   ```

### Files Not Processing

**Symptoms:** Files are dropped into watched directory but nothing happens.

**Diagnosis:**
```bash
# Check if watcher is running
journalctl -u renamed -f

# Check health endpoint
echo "" | nc -U /tmp/renamed-health.sock

# Check for pattern match issues
renamed config show | grep patterns
```

**Common causes:**

1. **File pattern mismatch:**
   ```bash
   # Default patterns: *.pdf, *.jpg, *.jpeg, *.png, *.tiff, *.tif
   # Add more patterns in config:
   watch:
     patterns: ["*.pdf", "*.doc", "*.docx"]
   ```

2. **File permissions:**
   ```bash
   # Service user must be able to read files
   sudo -u renamed cat /var/watch/inbox/test.pdf
   ```

3. **File still being written:**
   ```bash
   # Watcher waits for file to be stable (2 seconds by default)
   # For large files over slow network, increase debounce:
   rateLimit:
     debounceMs: 5000
   ```

4. **API authentication expired:**
   ```bash
   sudo -u renamed /opt/renamed/node_modules/.bin/renamed auth whoami
   # Re-authenticate if needed
   ```

5. **Rate limited:**
   ```bash
   # Check queue backlog in health endpoint
   echo "" | nc -U /tmp/renamed-health.sock | jq '.queue'
   ```

### Files Going to Failed Directory

**Symptoms:** Files move to failed directory instead of organized output.

**Diagnosis:**
```bash
# Check recent errors in logs
journalctl -u renamed -p err --since "1 hour ago"

# Check failed files
ls -la /var/watch/failed/
```

**Common causes:**

1. **API errors:**
   - Check API status at https://renamed.to/status
   - Verify authentication is valid

2. **File too large:**
   - Maximum size is 25MB for rename operations
   - Check file size: `ls -lh /var/watch/failed/`

3. **Unsupported file type:**
   - Only PDF, JPG, JPEG, PNG, TIFF supported
   - Check actual file type: `file /var/watch/failed/filename`

4. **Network issues:**
   - Check connectivity: `curl -I https://api.renamed.to`
   - Check DNS resolution

**Recovery:**
```bash
# Re-process failed files after fixing the issue
mv /var/watch/failed/* /var/watch/inbox/
```

### Health Socket Not Responding

**Symptoms:** `nc -U /tmp/renamed-health.sock` hangs or returns nothing.

**Diagnosis:**
```bash
# Check if socket exists
ls -la /tmp/renamed-health.sock

# Check if service is running
systemctl status renamed

# Check socket permissions
stat /tmp/renamed-health.sock
```

**Common causes:**

1. **Service not running:**
   ```bash
   systemctl start renamed
   ```

2. **Socket path mismatch:**
   ```bash
   # Check configured path
   renamed config show | grep socketPath
   ```

3. **Health disabled in config:**
   ```yaml
   health:
     enabled: true  # Make sure this is true
   ```

4. **Stale socket file:**
   ```bash
   # Remove stale socket and restart
   sudo rm /tmp/renamed-health.sock
   systemctl restart renamed
   ```

### High Memory Usage

**Symptoms:** Service using excessive memory, possible OOM kills.

**Diagnosis:**
```bash
# Check memory usage
systemctl status renamed

# Check for large queue
echo "" | nc -U /tmp/renamed-health.sock | jq '.queue.pending'
```

**Solutions:**

1. **Reduce concurrency:**
   ```yaml
   rateLimit:
     concurrency: 1  # Process one file at a time
   ```

2. **Large file backlog:**
   ```bash
   # Process files in batches
   # Move excess files out temporarily
   mv /var/watch/inbox/*.pdf /tmp/backlog/
   # Move back in smaller batches
   ```

3. **Memory leak (rare):**
   ```bash
   # Restart service periodically
   systemctl restart renamed
   ```

### Graceful Shutdown Issues

**Symptoms:** Service takes too long to stop or files left in inconsistent state.

**Configuration:**
```bash
# Check TimeoutStopSec in service file
grep TimeoutStopSec /etc/systemd/system/renamed.service

# Increase if processing large files
# [Service]
# TimeoutStopSec=60
```

**Manual graceful shutdown:**
```bash
# Send SIGTERM (graceful)
systemctl stop renamed

# Wait for completion
journalctl -u renamed -f
# Should see: "Shutdown complete"
```

### Config File Not Loading

**Symptoms:** Settings in config file are ignored.

**Diagnosis:**
```bash
# Check which config files are loaded
renamed config path

# Validate config
renamed config validate

# Show effective config
renamed config show
```

**Common causes:**

1. **Wrong location:**
   ```bash
   # User config: ~/.config/renamed/config.yaml
   # System config: /etc/renamed/config.yaml
   ```

2. **YAML syntax error:**
   ```bash
   renamed config validate
   # Will show specific error location
   ```

3. **Permission denied:**
   ```bash
   # Service user must be able to read config
   sudo -u renamed cat /etc/renamed/config.yaml
   ```

### Debugging Tips

1. **Enable debug logging:**
   ```yaml
   logging:
     level: debug
   ```

2. **Use dry-run mode:**
   ```bash
   renamed watch /var/inbox --dry-run
   ```

3. **Test single file:**
   ```bash
   renamed rename /path/to/test.pdf --apply
   ```

4. **Check all logs:**
   ```bash
   journalctl -u renamed --since "today" > /tmp/renamed-logs.txt
   ```

5. **Monitor in real-time:**
   ```bash
   # Terminal 1: Watch logs
   journalctl -u renamed -f

   # Terminal 2: Watch health
   watch -n 5 'echo "" | nc -U /tmp/renamed-health.sock | jq'

   # Terminal 3: Drop test file
   cp test.pdf /var/watch/inbox/
   ```

## Updating

```bash
# Stop service
sudo systemctl stop renamed

# Update package
cd /opt/renamed
sudo -u renamed npm update @renamed-to/cli

# Restart
sudo systemctl start renamed

# Verify
systemctl status renamed
```

## Security Considerations

1. **API Credentials**: Store in environment variables or use device flow
2. **File Permissions**: Ensure renamed user can only access needed directories
3. **Network**: The service only makes outbound HTTPS connections to api.renamed.to
4. **systemd Hardening**: The example unit file includes security restrictions

## Directory Structure

```
/opt/renamed/                    # CLI installation
  node_modules/
  package.json

/var/watch/
  inbox/                         # Watched directory (drop files here)
  failed/                        # Files that failed processing

/var/organized/                  # Organized output
  invoices/                      # AI-suggested folder
    2024/
      acme-invoice-001.pdf       # AI-suggested filename

/etc/renamed/
  config.yaml                    # System config (optional)

~/.config/renamed/
  config.yaml                    # User config (optional)

/tmp/renamed-health.sock         # Health check socket
```
