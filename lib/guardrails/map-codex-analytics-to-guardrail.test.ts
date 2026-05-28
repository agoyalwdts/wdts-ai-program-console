import { describe, expect, it } from "vitest";
import {
  CODEX_GUARD_HIGH_CREDITS_PER_DAY,
  inferCodexModelForGuardrail,
  mapCodexUsageRowToGuardrailUsage,
} from "./map-codex-analytics-to-guardrail";

describe("mapCodexUsageRowToGuardrailUsage", () => {
  const since = new Date("2026-05-27T00:00:00Z").getTime();

  it("maps a per-user bucket with email into CODEX guardrail row", () => {
    const row = mapCodexUsageRowToGuardrailUsage({
      sinceMs: since,
      usdPerCredit: 0.05,
      row: {
        object: "usage",
        start_time: Math.floor(new Date("2026-05-27T00:00:00Z").getTime() / 1000),
        end_time: Math.floor(new Date("2026-05-27T23:59:59Z").getTime() / 1000),
        email: "dev@wdtablesystems.com",
        totals: { threads: 2, turns: 5, credits: 30 },
        clients: [{ client_id: "codex-cli", credits: 30, turns: 5 }],
      },
    });
    expect(row).not.toBeNull();
    expect(row!.usage.product).toBe("CODEX");
    expect(row!.usage.userEmail).toBe("dev@wdtablesystems.com");
    expect(row!.usage.model).toBe("gpt-5-codex-max");
    expect(row!.usage.costUsd).toBeCloseTo(1.5, 5);
  });

  it("skips buckets before the scan window", () => {
    const row = mapCodexUsageRowToGuardrailUsage({
      sinceMs: since,
      usdPerCredit: 0.05,
      row: {
        object: "usage",
        start_time: Math.floor(new Date("2026-05-20T00:00:00Z").getTime() / 1000),
        end_time: Math.floor(new Date("2026-05-20T23:59:59Z").getTime() / 1000),
        email: "dev@wdtablesystems.com",
        totals: { threads: 1, turns: 1, credits: 5 },
        clients: [],
      },
    });
    expect(row).toBeNull();
  });

  it("uses default model for low credit usage", () => {
    expect(
      inferCodexModelForGuardrail({
        credits: 2,
        turns: 10,
        dominantClientId: "vscode",
      }),
    ).toBe("gpt-5-codex-medium");
    expect(
      inferCodexModelForGuardrail({
        credits: CODEX_GUARD_HIGH_CREDITS_PER_DAY + 5,
        turns: 5,
        dominantClientId: "vscode",
      }),
    ).toBe("gpt-5-codex-max");
  });
});
