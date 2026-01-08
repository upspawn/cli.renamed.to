import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQueue } from "./queue.js";
import type { Logger } from "./logger.js";

const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

describe("queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes tasks up to concurrency limit", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 2,
      retryAttempts: 0,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    const executing: string[] = [];
    const completed: string[] = [];

    const createTask = (id: string, delay: number) => ({
      id,
      execute: async () => {
        executing.push(id);
        await new Promise((r) => setTimeout(r, delay));
        executing.splice(executing.indexOf(id), 1);
        completed.push(id);
        return id;
      },
    });

    queue.enqueue(createTask("a", 100));
    queue.enqueue(createTask("b", 100));
    queue.enqueue(createTask("c", 100));

    // After first tick, 2 should be executing (concurrency limit)
    await vi.advanceTimersByTimeAsync(10);
    expect(executing.length).toBeLessThanOrEqual(2);

    // After 200ms, all should complete
    await vi.advanceTimersByTimeAsync(200);
    expect(completed).toContain("a");
    expect(completed).toContain("b");
    expect(completed).toContain("c");
  });

  it("retries failed tasks with exponential backoff", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 1,
      retryAttempts: 2,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    let attempts = 0;

    queue.enqueue({
      id: "flaky",
      execute: async () => {
        attempts++;
        if (attempts < 3) throw new Error("Fail");
        return "success";
      },
    });

    // First attempt fails immediately
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);

    // First retry after 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(2);

    // Second retry after 2000ms (exponential)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(3);

    const stats = queue.getStats();
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("marks task as failed after all retries exhausted", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 1,
      retryAttempts: 2,
      retryDelayMs: 100,
      logger: mockLogger,
    });

    queue.enqueue({
      id: "always-fails",
      execute: async () => {
        throw new Error("Always fails");
      },
    });

    // Initial attempt
    await vi.advanceTimersByTimeAsync(10);

    // First retry (100ms)
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(10);

    // Second retry (200ms)
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(10);

    const stats = queue.getStats();
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Task failed permanently",
      expect.objectContaining({ taskId: "always-fails" })
    );
  });

  it("drain waits for all tasks to complete", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 1,
      retryAttempts: 0,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    let completed = false;

    queue.enqueue({
      id: "slow",
      execute: async () => {
        await new Promise((r) => setTimeout(r, 500));
        completed = true;
        return "done";
      },
    });

    const drainPromise = queue.drain();

    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(600);

    await drainPromise;
    expect(completed).toBe(true);
  });

  it("drain resolves immediately when queue is empty", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 1,
      retryAttempts: 0,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it("pause stops processing new tasks", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 1,
      retryAttempts: 0,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    const executed: string[] = [];

    queue.enqueue({
      id: "first",
      execute: async () => {
        executed.push("first");
        return "first";
      },
    });

    // Pause before processing completes
    queue.pause();

    queue.enqueue({
      id: "second",
      execute: async () => {
        executed.push("second");
        return "second";
      },
    });

    await vi.advanceTimersByTimeAsync(100);

    // First may have started, but second should not process while paused
    expect(queue.isPaused()).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Queue paused",
      expect.anything()
    );
  });

  it("resume continues processing after pause", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 1,
      retryAttempts: 0,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    const executed: string[] = [];

    queue.pause();

    queue.enqueue({
      id: "task",
      execute: async () => {
        executed.push("task");
        return "task";
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(executed).toHaveLength(0);

    queue.resume();
    await vi.advanceTimersByTimeAsync(100);

    expect(executed).toContain("task");
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Queue resumed",
      expect.anything()
    );
  });

  it("getStats returns correct statistics", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 2,
      retryAttempts: 0,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    queue.enqueue({
      id: "success",
      execute: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return "ok";
      },
    });

    queue.enqueue({
      id: "fail",
      execute: async () => {
        throw new Error("fail");
      },
    });

    await vi.advanceTimersByTimeAsync(100);

    const stats = queue.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.totalProcessed).toBe(2);
  });

  it("calculates average latency", async () => {
    const mockLogger = createMockLogger();
    const queue = createQueue({
      concurrency: 1,
      retryAttempts: 0,
      retryDelayMs: 1000,
      logger: mockLogger,
    });

    queue.enqueue({
      id: "task1",
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return "ok";
      },
    });

    queue.enqueue({
      id: "task2",
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return "ok";
      },
    });

    await vi.advanceTimersByTimeAsync(300);

    const stats = queue.getStats();
    expect(stats.averageLatencyMs).toBeGreaterThan(0);
  });
});
