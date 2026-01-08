# Dockerfile for testing renamed.to CLI watch mode
# Build locally first: pnpm build
FROM node:20-slim

# Install netcat for health check testing
RUN apt-get update && apt-get install -y netcat-openbsd && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json for production dependencies
COPY package.json ./

# Install pnpm and production dependencies only
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN pnpm install --prod

# Copy pre-built dist (build locally first with pnpm build)
COPY dist ./dist

# Create test directories
RUN mkdir -p /var/watch/inbox /var/watch/failed /var/organized

# Default command - show help
CMD ["node", "dist/index.js", "--help"]
