import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Product } from "@prisma/client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.INTEGRATION_CURSOR = "real";
  process.env.CURSOR_TEAM_ADMIN_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  delete process.env.INTEGRATION_CURSOR;
  delete process.env.CURSOR_TEAM_ADMIN_API_KEY;
});

function page(events: object[]) {
  return {
    usageEvents: events,
    pagination: { currentPage: 1, pageSize: 500, numPages: 1, hasNextPage: false },
  };
}

describe("loadCursorUsageForGuardrailMonitor", () => {
  it("returns rows with model and tokens from filtered-usage-events", async () => {
    const ts = Date.now() - 60_000;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(
          page([
            {
              timestamp: String(ts),
              userEmail: "dev@wdts.com",
              model: "claude-4.6-opus-max",
              maxMode: true,
              tokenUsage: {
                inputTokens: 100,
                outputTokens: 50,
                cacheWriteTokens: 10,
                cacheReadTokens: 1000,
              },
              chargedCents: 250,
            },
          ]),
        ),
    });

    const { loadCursorUsageForGuardrailMonitor } = await import("./load-cursor-usage-for-monitor");
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const out = await loadCursorUsageForGuardrailMonitor({ since });

    expect(out.active).toBe(true);
    expect(out.rowsInWindow).toBe(1);
    expect(out.rows[0]?.product).toBe(Product.CURSOR);
    expect(out.rows[0]?.model).toContain("opus");
    expect(out.rows[0]?.tokensIn).toBe(100);
    expect(out.rows[0]?.tokensOut).toBe(50);
    expect(out.rows[0]?.maxMode).toBe(true);
  });

  it("skips when cursor integration is synthetic", async () => {
    process.env.INTEGRATION_CURSOR = "synthetic";
    const { loadCursorUsageForGuardrailMonitor } = await import("./load-cursor-usage-for-monitor");
    const out = await loadCursorUsageForGuardrailMonitor({
      since: new Date(Date.now() - 3600_000),
    });
    expect(out.active).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mapCursorParsedRowToGuardrailUsage", () => {
  it("maps parsed cursor row to guardrail usage shape", async () => {
    const { mapCursorParsedRowToGuardrailUsage } = await import("./load-cursor-usage-for-monitor");
    const row = mapCursorParsedRowToGuardrailUsage({
      occurredAt: new Date("2026-05-01T12:00:00Z"),
      userEmail: "a@b.c",
      team: "",
      kind: "",
      model: "gpt-5",
      maxMode: false,
      inputCacheWrite: 0,
      inputNoCache: 20,
      cacheRead: 0,
      outputTokens: 5,
      totalTokens: 25,
      costUsd: 0.5,
    });
    expect(row.product).toBe(Product.CURSOR);
    expect(row.tokensIn).toBe(20);
    expect(row.userEmail).toBe("a@b.c");
  });
});
