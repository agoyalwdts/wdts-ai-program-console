import { describe, expect, it, vi } from "vitest";
import {
  calendarYmdFromMillis,
  cursorChargedFieldToUsd,
  fetchCursorFilteredUsageByUtcDay,
  resolveCursorTeamAdminApiKey,
} from "./team-admin-usage";

describe("resolveCursorTeamAdminApiKey", () => {
  it("prefers CURSOR_TEAM_ADMIN_API_KEY", () => {
    expect(
      resolveCursorTeamAdminApiKey({
        CURSOR_TEAM_ADMIN_API_KEY: "a",
        CURSOR_ADMIN_TOKEN: "b",
      }),
    ).toBe("a");
  });

  it("falls back to CURSOR_ADMIN_TOKEN", () => {
    expect(
      resolveCursorTeamAdminApiKey({
        CURSOR_ADMIN_TOKEN: "tok",
      }),
    ).toBe("tok");
  });
});

describe("cursorChargedFieldToUsd", () => {
  it("converts API cents (integer) to USD", () => {
    expect(cursorChargedFieldToUsd(100)).toBe(1);
    expect(cursorChargedFieldToUsd(2136)).toBeCloseTo(21.36);
    expect(cursorChargedFieldToUsd(8)).toBeCloseTo(0.08);
  });

  it("converts fractional cents per Admin API examples (not dollars)", () => {
    expect(cursorChargedFieldToUsd(21.36232)).toBeCloseTo(0.2136232, 8);
    expect(cursorChargedFieldToUsd(37.33)).toBeCloseTo(0.3733, 8);
  });

  it("handles large cent totals and float noise via single ÷100", () => {
    expect(cursorChargedFieldToUsd(522206.99999999994)).toBeCloseTo(5222.07, 2);
    expect(cursorChargedFieldToUsd(511257.99999999994)).toBeCloseTo(5112.58, 2);
    expect(cursorChargedFieldToUsd(522206.49)).toBeCloseTo(5222.06, 2);
    expect(cursorChargedFieldToUsd(517026.33)).toBeCloseTo(5170.26, 2);
  });

  it("handles sub-integer cent noise", () => {
    expect(cursorChargedFieldToUsd(49.99999999999994)).toBeCloseTo(0.5, 8);
    expect(cursorChargedFieldToUsd(21.000000000000004)).toBeCloseTo(0.21, 8);
  });

  it("coerces numeric strings from JSON", () => {
    expect(cursorChargedFieldToUsd("2136")).toBeCloseTo(21.36, 8);
  });
});

describe("calendarYmdFromMillis", () => {
  it("formats local calendar date", () => {
    vi.stubEnv("TZ", "UTC");
    const ms = Date.UTC(2026, 4, 4, 15, 0, 0);
    expect(calendarYmdFromMillis(ms)).toBe("2026-05-04");
    vi.unstubAllEnvs();
  });
});

describe("fetchCursorFilteredUsageByUtcDay", () => {
  it("retries on 429 using Retry-After then succeeds", async () => {
    vi.useFakeTimers();
    const payload = JSON.stringify({
      usageEvents: [{ timestamp: String(Date.UTC(2026, 4, 4, 12, 0, 0)), chargedCents: 100 }],
      pagination: { hasNextPage: false, currentPage: 1, pageSize: 500, numPages: 1 },
    });
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          ok: false,
          headers: {
            get: (n: string) => (n.toLowerCase() === "retry-after" ? "1" : null),
          },
          text: async () => '{"code":"error"}',
        } as unknown as Response;
      }
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () => payload,
      } as unknown as Response;
    });

    const start = Date.UTC(2026, 4, 4, 0, 0, 0);
    const end = Date.UTC(2026, 4, 4, 23, 59, 59);
    const p = fetchCursorFilteredUsageByUtcDay({
      startMs: start,
      endMs: end,
      opts: { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    await vi.advanceTimersByTimeAsync(5000);
    const map = await p;
    vi.useRealTimers();

    expect(calls).toBe(2);
    const ymd = calendarYmdFromMillis(Date.UTC(2026, 4, 4, 12, 0, 0));
    expect(map.get(ymd)?.spendUsd).toBeCloseTo(1);
    expect(map.get(ymd)?.eventCount).toBe(1);
  });

  it("aggregates chargedCents into daily buckets", async () => {
    const t0 = new Date(2026, 4, 4, 10, 0, 0).getTime();
    const t1 = new Date(2026, 4, 4, 11, 0, 0).getTime();
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            usageEvents: [
              { timestamp: String(t0), chargedCents: 100 },
              { timestamp: String(t1), chargedCents: 50 },
            ],
            pagination: { hasNextPage: false, currentPage: 1, pageSize: 500, numPages: 1 },
          }),
      } as Response;
    });

    const map = await fetchCursorFilteredUsageByUtcDay({
      startMs: t0,
      endMs: t1,
      opts: { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    });

    const ymd = calendarYmdFromMillis(t0);
    expect(map.get(ymd)?.spendUsd).toBeCloseTo(1.5);
    expect(map.get(ymd)?.eventCount).toBe(2);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
