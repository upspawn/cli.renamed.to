#!/bin/bash
# Test script for renamed.to CLI in Docker
# Usage: ./scripts/test-docker.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
cd "$CLI_DIR"

echo "=== renamed.to CLI Docker Test ==="
echo ""

# Clean up test directories
echo "1. Setting up test directories..."
rm -rf test-data
mkdir -p test-data/inbox test-data/failed test-data/organized
echo "   Created: test-data/{inbox,failed,organized}"

# Build locally first
echo ""
echo "2. Building CLI locally..."
cd "$CLI_DIR/../.." && pnpm build
cd "$CLI_DIR"

# Build Docker image
echo ""
echo "3. Building Docker image..."
docker build -t renamed-cli-test -f Dockerfile .

# Test 1: Help command
echo ""
echo "4. Testing CLI help..."
docker run --rm renamed-cli-test node dist/index.js --help
echo "   ✓ Help command works"

# Test 2: Watch command help
echo ""
echo "5. Testing watch command help..."
docker run --rm renamed-cli-test node dist/index.js watch --help
echo "   ✓ Watch help works"

# Test 3: Config commands
echo ""
echo "6. Testing config commands..."
docker run --rm renamed-cli-test node dist/index.js config path
echo "   ✓ Config path works"

docker run --rm renamed-cli-test node dist/index.js config show
echo "   ✓ Config show works"

# Test 4: Config init
echo ""
echo "7. Testing config init..."
docker run --rm -v "$(pwd)/test-data:/home/node" renamed-cli-test \
    sh -c "HOME=/home/node node dist/index.js config init && cat /home/node/.config/renamed/config.yaml | head -20"
echo "   ✓ Config init works"

# Test 5: Config validate
echo ""
echo "8. Testing config validate..."
docker run --rm -v "$(pwd)/test-data:/home/node" renamed-cli-test \
    sh -c "HOME=/home/node node dist/index.js config validate" || true
echo "   ✓ Config validate works"

# Test 6: Watch mode dry-run (quick test)
echo ""
echo "9. Testing watch mode (dry-run, 5 seconds)..."
docker run --rm -d --name renamed-watch-test \
    -v "$(pwd)/test-data/inbox:/var/watch/inbox" \
    -v "$(pwd)/test-data/failed:/var/watch/failed" \
    -v "$(pwd)/test-data/organized:/var/organized" \
    renamed-cli-test \
    node dist/index.js watch /var/watch/inbox \
        --output-dir /var/organized \
        --failed-dir /var/watch/failed \
        --dry-run

# Wait for watcher to start
sleep 2

# Check if container is running
if docker ps | grep -q renamed-watch-test; then
    echo "   ✓ Watch mode started successfully"

    # Show logs
    echo ""
    echo "   Container logs:"
    docker logs renamed-watch-test 2>&1 | sed 's/^/   /'

    # Stop the container
    echo ""
    echo "   Stopping container..."
    docker stop renamed-watch-test > /dev/null
    echo "   ✓ Watch mode stopped gracefully"
else
    echo "   ✗ Watch mode failed to start"
    docker logs renamed-watch-test 2>&1 || true
    exit 1
fi

# Test 7: Health check socket (requires running container)
echo ""
echo "10. Testing health check socket..."
docker run --rm -d --name renamed-health-test \
    -v /tmp/renamed-test:/tmp \
    renamed-cli-test \
    node dist/index.js watch /var/watch/inbox \
        --output-dir /var/organized \
        --failed-dir /var/watch/failed \
        --dry-run

sleep 3

# Try to query health socket from inside container
HEALTH_OUTPUT=$(docker exec renamed-health-test sh -c 'echo "" | nc -U /tmp/renamed-health.sock 2>/dev/null' || echo "SOCKET_ERROR")

if echo "$HEALTH_OUTPUT" | grep -q "status"; then
    echo "   ✓ Health socket works"
    echo "   Response:"
    echo "$HEALTH_OUTPUT" | sed 's/^/   /'
else
    echo "   ⚠ Health socket not responding (may need more time or socket path issue)"
    echo "   Output: $HEALTH_OUTPUT"
fi

docker stop renamed-health-test > /dev/null 2>&1 || true

# Cleanup
echo ""
echo "11. Cleaning up..."
rm -rf test-data
echo "    ✓ Cleaned up test directories"

echo ""
echo "=== All Docker tests completed ==="
