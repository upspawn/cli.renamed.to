import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHealthServer } from "./health.js";
import { createNoopLogger } from "./logger.js";
import type { QueueStats } from "./queue.js";

// Types for mock socket
interface MockSocket {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

type ConnectionHandler = ((socket: MockSocket) => void) | null;

// Create mock socket and server outside of module mock
let connectionHandler: ConnectionHandler = null;
const mockSocket: MockSocket = {
  write: vi.fn(),
  end: vi.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockServer: any = {
  on: vi.fn((event: string, handler: ConnectionHandler) => {
    if (event === "connection") {
      connectionHandler = handler;
    }
    return mockServer;
  }),
  listen: vi.fn((_path: string, callback: () => void) => {
    callback();
    return mockServer;
  }),
  close: vi.fn((callback: () => void) => {
    callback();
  }),
};

// Mock net module
vi.mock("net", () => ({
  createServer: vi.fn((handler: typeof connectionHandler) => {
    connectionHandler = handler;
    return mockServer;
  }),
}));

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));

import { existsSync, unlinkSync } from "fs";

describe("health", () => {
  const logger = createNoopLogger();
  const socketPath = "/tmp/test-health.sock";

  beforeEach(() => {
    vi.clearAllMocks();
    connectionHandler = null;
    vi.mocked(existsSync).mockReturnValue(false);
  });

  describe("createHealthServer", () => {
    it("creates a health server instance", () => {
      const server = createHealthServer(socketPath, logger);

      expect(server).toBeDefined();
      expect(typeof server.start).toBe("function");
      expect(typeof server.stop).toBe("function");
      expect(typeof server.updateStats).toBe("function");
      expect(typeof server.recordError).toBe("function");
      expect(typeof server.recordSuccess).toBe("function");
    });

    describe("start()", () => {
      it("starts the server on the socket path", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        expect(mockServer.listen).toHaveBeenCalledWith(
          socketPath,
          expect.any(Function)
        );
      });

      it("cleans up stale socket file if exists", async () => {
        vi.mocked(existsSync).mockReturnValue(true);

        const server = createHealthServer(socketPath, logger);
        await server.start();

        expect(unlinkSync).toHaveBeenCalledWith(socketPath);
      });

      it("ignores errors when cleaning up stale socket", async () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(unlinkSync).mockImplementation(() => {
          throw new Error("Socket in use");
        });

        const server = createHealthServer(socketPath, logger);

        await expect(server.start()).resolves.not.toThrow();
      });
    });

    describe("stop()", () => {
      it("closes the server", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        await server.stop();

        expect(mockServer.close).toHaveBeenCalled();
      });

      it("cleans up socket file on stop", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        vi.mocked(existsSync).mockReturnValue(true);
        await server.stop();

        expect(unlinkSync).toHaveBeenCalled();
      });

      it("resolves immediately if server not started", async () => {
        const server = createHealthServer(socketPath, logger);
        await expect(server.stop()).resolves.not.toThrow();
      });
    });

    describe("updateStats()", () => {
      it("updates the queue statistics", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        const stats: QueueStats = {
          pending: 5,
          active: 2,
          completed: 10,
          failed: 1,
          totalProcessed: 11,
          averageLatencyMs: 150,
        };

        server.updateStats(stats);

        // Trigger a connection to get the status
        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        expect(mockSocket.write).toHaveBeenCalled();
        const output = mockSocket.write.mock.calls[0][0];
        const status = JSON.parse(output);

        expect(status.queue.pending).toBe(5);
        expect(status.queue.active).toBe(2);
        expect(status.queue.completed).toBe(10);
        expect(status.queue.failed).toBe(1);
      });
    });

    describe("recordError()", () => {
      it("increments the error count", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        server.recordError();
        server.recordError();

        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        const output = mockSocket.write.mock.calls[0][0];
        const status = JSON.parse(output);

        expect(status.errors).toBe(2);
      });
    });

    describe("recordSuccess()", () => {
      it("updates lastProcessedAt timestamp", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        server.recordSuccess();

        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        const output = mockSocket.write.mock.calls[0][0];
        const status = JSON.parse(output);

        expect(status.lastProcessedAt).toBeDefined();
        expect(new Date(status.lastProcessedAt)).toBeInstanceOf(Date);
      });
    });

    describe("health status calculation", () => {
      it("returns healthy status with default stats", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        const output = mockSocket.write.mock.calls[0][0];
        const status = JSON.parse(output);

        expect(status.status).toBe("healthy");
        expect(status.uptime).toBeGreaterThanOrEqual(0);
      });

      it("returns degraded status when failure rate exceeds 10%", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        const stats: QueueStats = {
          pending: 0,
          active: 0,
          completed: 8,
          failed: 2,
          totalProcessed: 10,
          averageLatencyMs: 100,
        };
        server.updateStats(stats);

        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        const output = mockSocket.write.mock.calls[0][0];
        const status = JSON.parse(output);

        expect(status.status).toBe("degraded");
      });

      it("returns degraded status when pending queue exceeds threshold", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        const stats: QueueStats = {
          pending: 150,
          active: 2,
          completed: 10,
          failed: 0,
          totalProcessed: 10,
          averageLatencyMs: 100,
        };
        server.updateStats(stats);

        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        const output = mockSocket.write.mock.calls[0][0];
        const status = JSON.parse(output);

        expect(status.status).toBe("degraded");
      });

      it("returns healthy status when below thresholds", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        const stats: QueueStats = {
          pending: 50,
          active: 2,
          completed: 95,
          failed: 5,
          totalProcessed: 100,
          averageLatencyMs: 100,
        };
        server.updateStats(stats);

        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        const output = mockSocket.write.mock.calls[0][0];
        const status = JSON.parse(output);

        expect(status.status).toBe("healthy");
      });
    });

    describe("connection handling", () => {
      it("writes JSON response and ends connection", async () => {
        const server = createHealthServer(socketPath, logger);
        await server.start();

        if (connectionHandler) {
          connectionHandler(mockSocket);
        }

        expect(mockSocket.write).toHaveBeenCalled();
        expect(mockSocket.end).toHaveBeenCalled();
      });
    });
  });
});
