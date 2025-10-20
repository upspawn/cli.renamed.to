import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveToken } from "./auth.js";

describe("resolveToken", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns provided token option", async () => {
    await expect(resolveToken({ token: "abc" })).resolves.toBe("abc");
  });

  it("prompts for token when missing", async () => {
    vi.mock("prompts", () => ({
      default: vi.fn(() => Promise.resolve({ token: "prompted" }))
    }));

    const { resolveToken: mockedResolve } = await import("./auth.js");
    await expect(mockedResolve({})).resolves.toBe("prompted");
  });

  it("throws if non-interactive without token", async () => {
    await expect(resolveToken({ nonInteractive: true })).rejects.toThrow(/interactive/);
  });
});
