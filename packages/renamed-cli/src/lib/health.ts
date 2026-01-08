import { createServer, type Server, type Socket } from "net";
import { unlinkSync, existsSync } from "fs";
import type { QueueStats } from "./queue.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthStatus {
  /** Current health status */
  status: "healthy" | "degraded" | "unhealthy";
  /** Seconds since service start */
  uptime: number;
  /** Queue statistics */
  queue: QueueStats;
  /** ISO timestamp of last successful file processing */
  lastProcessedAt?: string;
  /** Total error count since start */
  errors: number;
}

export interface HealthServer {
  /** Start the health server */
  start(): Promise<void>;
  /** Stop the health server and clean up socket */
  stop(): Promise<void>;
  /** Update queue statistics */
  updateStats(stats: QueueStats): void;
  /** Record an error occurrence */
  recordError(): void;
  /** Record a successful processing */
  recordSuccess(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Failure rate threshold for degraded status (10%) */
const DEGRADED_FAILURE_RATE = 0.1;

/** Pending count threshold for degraded status */
const DEGRADED_PENDING_THRESHOLD = 100;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a Unix socket health server.
 * Responds to connections with JSON health status.
 *
 * Query with: echo "" | nc -U /tmp/renamed-health.sock
 */
export function createHealthServer(
  socketPath: string,
  logger: Logger
): HealthServer {
  const startTime = Date.now();
  let server: Server | null = null;
  let lastStats: QueueStats | null = null;
  let lastProcessedAt: Date | null = null;
  let errorCount = 0;

  function getStatus(): HealthStatus {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const queue: QueueStats = lastStats ?? {
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      totalProcessed: 0,
      averageLatencyMs: 0,
    };

    // Determine health status based on metrics
    let status: HealthStatus["status"] = "healthy";

    // Check failure rate
    if (queue.totalProcessed > 0) {
      const failureRate = queue.failed / queue.totalProcessed;
      if (failureRate > DEGRADED_FAILURE_RATE) {
        status = "degraded";
      }
    }

    // Check backlog size
    if (queue.pending > DEGRADED_PENDING_THRESHOLD) {
      status = "degraded";
    }

    return {
      status,
      uptime,
      queue,
      lastProcessedAt: lastProcessedAt?.toISOString(),
      errors: errorCount,
    };
  }

  function handleConnection(socket: Socket): void {
    const status = getStatus();
    const response = JSON.stringify(status, null, 2);
    socket.write(response);
    socket.end();
  }

  async function start(): Promise<void> {
    // Clean up stale socket file
    if (existsSync(socketPath)) {
      try {
        unlinkSync(socketPath);
      } catch {
        // Ignore errors - socket might be in use
      }
    }

    return new Promise((resolve, reject) => {
      server = createServer(handleConnection);

      server.on("error", (err) => {
        logger.error("Health server error", { error: err.message, socketPath });
        reject(err);
      });

      server.listen(socketPath, () => {
        logger.info("Health server started", { socketPath });
        resolve();
      });
    });
  }

  async function stop(): Promise<void> {
    return new Promise((resolve) => {
      if (server) {
        server.close(() => {
          // Clean up socket file
          if (existsSync(socketPath)) {
            try {
              unlinkSync(socketPath);
            } catch {
              // Ignore cleanup errors
            }
          }
          logger.info("Health server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  function updateStats(stats: QueueStats): void {
    lastStats = stats;
  }

  function recordError(): void {
    errorCount++;
  }

  function recordSuccess(): void {
    lastProcessedAt = new Date();
  }

  return {
    start,
    stop,
    updateStats,
    recordError,
    recordSuccess,
  };
}
