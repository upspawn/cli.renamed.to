import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueueTask<T> {
  /** Unique identifier for this task */
  id: string;
  /** Function that performs the actual work */
  execute: () => Promise<T>;
  /** Current retry count (managed internally) */
  retryCount?: number;
}

export interface QueueOptions {
  /** Maximum number of concurrent tasks */
  concurrency: number;
  /** Number of times to retry a failed task */
  retryAttempts: number;
  /** Base delay between retries (exponential backoff applied) */
  retryDelayMs: number;
  /** Logger instance for queue operations */
  logger: Logger;
}

export interface QueueStats {
  /** Number of tasks waiting to be processed */
  pending: number;
  /** Number of tasks currently being processed */
  active: number;
  /** Number of tasks completed successfully */
  completed: number;
  /** Number of tasks that failed permanently */
  failed: number;
  /** Total number of tasks processed (completed + failed) */
  totalProcessed: number;
  /** Average processing time in milliseconds */
  averageLatencyMs: number;
}

export interface ProcessingQueue<T> {
  /** Add a task to the queue */
  enqueue(task: QueueTask<T>): void;
  /** Get current queue statistics */
  getStats(): QueueStats;
  /** Wait for all pending and active tasks to complete */
  drain(): Promise<void>;
  /** Pause processing (active tasks will complete) */
  pause(): void;
  /** Resume processing after pause */
  resume(): void;
  /** Check if queue is paused */
  isPaused(): boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of latency samples to keep for rolling average */
const MAX_LATENCY_SAMPLES = 100;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a rate-limited processing queue.
 * Handles concurrent execution, retries with exponential backoff,
 * and graceful drain for shutdown.
 */
export function createQueue<T>(options: QueueOptions): ProcessingQueue<T> {
  const { concurrency, retryAttempts, retryDelayMs, logger } = options;

  const pending: QueueTask<T>[] = [];
  const active = new Set<string>();
  const latencies: number[] = [];

  let completed = 0;
  let failed = 0;
  let paused = false;
  let drainResolve: (() => void) | null = null;

  function getStats(): QueueStats {
    const avgLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;

    return {
      pending: pending.length,
      active: active.size,
      completed,
      failed,
      totalProcessed: completed + failed,
      averageLatencyMs: Math.round(avgLatency),
    };
  }

  function checkDrainComplete(): void {
    if (drainResolve && pending.length === 0 && active.size === 0) {
      drainResolve();
      drainResolve = null;
    }
  }

  function processNext(): void {
    if (paused) return;

    // Check if drain is complete
    checkDrainComplete();

    // Process up to concurrency limit
    while (active.size < concurrency && pending.length > 0) {
      const task = pending.shift();
      if (task) {
        // Don't await - let it run concurrently
        void processTask(task);
      }
    }
  }

  async function processTask(task: QueueTask<T>): Promise<void> {
    const startTime = Date.now();
    const retryCount = task.retryCount ?? 0;

    active.add(task.id);
    logger.debug("Processing task", { taskId: task.id, retryCount });

    try {
      await task.execute();
      const latency = Date.now() - startTime;
      latencies.push(latency);

      // Keep only recent latencies for rolling average
      if (latencies.length > MAX_LATENCY_SAMPLES) latencies.shift();

      completed++;
      logger.info("Task completed", { taskId: task.id, latencyMs: latency });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (retryCount < retryAttempts) {
        // Schedule retry with exponential backoff
        const delay = retryDelayMs * Math.pow(2, retryCount);
        logger.warn("Task failed, scheduling retry", {
          taskId: task.id,
          retryCount: retryCount + 1,
          maxRetries: retryAttempts,
          retryDelayMs: delay,
          error: errorMessage,
        });

        setTimeout(() => {
          enqueue({ ...task, retryCount: retryCount + 1 });
        }, delay);
      } else {
        failed++;
        logger.error("Task failed permanently", {
          taskId: task.id,
          retryCount,
          error: errorMessage,
        });
      }
    } finally {
      active.delete(task.id);
      processNext();
    }
  }

  function enqueue(task: QueueTask<T>): void {
    pending.push(task);
    logger.debug("Task enqueued", {
      taskId: task.id,
      pendingCount: pending.length,
    });
    processNext();
  }

  function drain(): Promise<void> {
    if (pending.length === 0 && active.size === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      drainResolve = resolve;
      // Check immediately in case queue emptied between check and promise
      checkDrainComplete();
    });
  }

  function pause(): void {
    paused = true;
    logger.info("Queue paused", { pending: pending.length, active: active.size });
  }

  function resume(): void {
    paused = false;
    logger.info("Queue resumed", { pending: pending.length });
    processNext();
  }

  function isPaused(): boolean {
    return paused;
  }

  return {
    enqueue,
    getStats,
    drain,
    pause,
    resume,
    isPaused,
  };
}
