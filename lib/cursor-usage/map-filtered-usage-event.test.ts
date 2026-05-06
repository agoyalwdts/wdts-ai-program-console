import { describe, expect, it } from "vitest";
import { mapFilteredUsageEventToParsedRow } from "./map-filtered-usage-event";
import { evaluatePrudence } from "./rules";
import type { CursorFilteredUsageEventFull } from "@/lib/integrations/cursor/team-admin-usage";

describe("mapFilteredUsageEventToParsedRow", () => {
  it("maps Admin API sample fields into a row prudence rules accept", () => {
    const ev: CursorFilteredUsageEventFull = {
      timestamp: String(Date.UTC(2026, 4, 4, 12, 0, 0)),
      userEmail: "dev@company.com",
      model: "claude-4.6-opus-max-thinking-fast",
      kind: "Usage-based",
      maxMode: true,
      isTokenBasedCall: true,
      /** $14.79 — field is cents per Admin API */
      chargedCents: 1479,
      tokenUsage: {
        inputTokens: 167_907,
        outputTokens: 13_340,
        cacheWriteTokens: 160_882,
        cacheReadTokens: 2_117_021,
      },
    };
    const row = mapFilteredUsageEventToParsedRow(ev);
    expect(row).not.toBeNull();
    if (!row) return;
    expect(row.userEmail).toBe("dev@company.com");
    expect(row.maxMode).toBe(true);
    expect(row.cacheRead).toBe(2_117_021);
    expect(row.outputTokens).toBe(13_340);
    expect(row.costUsd).toBeCloseTo(14.79, 2);
    const hit = evaluatePrudence(row);
    expect(hit?.ruleCode).toBe("OPUS_MAX_THINKING_LOW_OUTPUT_VS_CACHE");
  });

  it("returns null without email or model", () => {
    expect(
      mapFilteredUsageEventToParsedRow({
        timestamp: "1",
        userEmail: "",
        model: "x",
      }),
    ).toBeNull();
    expect(
      mapFilteredUsageEventToParsedRow({
        timestamp: "1",
        userEmail: "a@b.c",
        model: "",
      }),
    ).toBeNull();
  });
});
