import { describe, expect, it, vi } from "vitest";
import {
  calendarYmdFromMillis,
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

describe("calendarYmdFromMillis", () => {
  it("formats local calendar date", () => {
    vi.stubEnv("TZ", "UTC");
    const ms = Date.UTC(2026, 4, 4, 15, 0, 0);
    expect(calendarYmdFromMillis(ms)).toBe("2026-05-04");
    vi.unstubAllEnvs();
  });
});

describe("fetchCursorFilteredUsageByUtcDay", () => {
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
