import { describe, expect, it } from "vitest";
import type { OpenAiDailyMergedSpend } from "./f1-openai-daily-spend";
import {
  computeWaCreditUpliftRatio,
  dominantOpenAiEnvelopeSource,
  hasWaOnlyDaysInPeriod,
  preferVendorUnifiedUsdByYmd,
  resolveOpenAiPortalEnvelope,
  sumOpenAiPortalAlignedEnvelopeUsd,
  sumOpenAiWaCalibratedEnvelopeUsd,
  sumPortalEnvelopeProductUsd,
  volumeWeightedUnifiedCodShare,
  type OpenAiOrgEnvelopeLayers,
} from "./f1-openai-org-envelope";
import { OPENAI_CREDIT_OVERAGE_USD } from "./program";

function emptyMerged(): OpenAiDailyMergedSpend {
  return {
    chatgpt: {
      periodTotalUsd: 0,
      byChartDay: new Map(),
      byYmd: new Map(),
      byYmdSource: new Map(),
      usedVendorMirror: false,
      dominantSource: "gateway",
    },
    codex: {
      periodTotalUsd: 0,
      byChartDay: new Map(),
      byYmd: new Map(),
      byYmdSource: new Map(),
      usedVendorMirror: false,
      dominantSource: "gateway",
    },
  };
}

describe("preferVendorUnifiedUsdByYmd", () => {
  it("uses vendor daily totals when present and snapshot only for gaps", () => {
    const vendor = new Map([["2026-06-01", 100], ["2026-06-02", 200]]);
    const snapshot = new Map([
      ["2026-06-01", 150],
      ["2026-06-02", 180],
      ["2026-06-03", 75],
    ]);
    const merged = preferVendorUnifiedUsdByYmd(vendor, snapshot);
    expect(merged.get("2026-06-01")).toBe(100);
    expect(merged.get("2026-06-02")).toBe(200);
    expect(merged.get("2026-06-03")).toBe(75);
  });
});

describe("sumOpenAiPortalAlignedEnvelopeUsd", () => {
  it("prefers org-costs over Workspace Analytics when both exist for a day", () => {
    const merged = emptyMerged();
    merged.chatgpt.byYmd.set("2026-06-01", 100);
    merged.chatgpt.byYmdSource.set("2026-06-01", "workspace_analytics");

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(),
      unifiedCodByYmd: new Map(),
      orgCostsChatByYmd: new Map([["2026-06-01", 80]]),
      orgCostsCodByYmd: new Map([["2026-06-01", 70]]),
      workspacePoolByYmd: new Map([["2026-06-01", 100]]),
    };

    const usd = sumOpenAiPortalAlignedEnvelopeUsd({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 1, 23, 59, 59),
    });

    expect(usd).toBe(150);
  });

  it("prefers unified credits over org-costs and WA", () => {
    const merged = emptyMerged();
    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map([["2026-06-21", 40]]),
      unifiedCodByYmd: new Map([["2026-06-21", 60]]),
      orgCostsChatByYmd: new Map([["2026-06-21", 999]]),
      orgCostsCodByYmd: new Map([["2026-06-21", 999]]),
      workspacePoolByYmd: new Map([["2026-06-21", 999]]),
    };

    const usd = sumOpenAiPortalAlignedEnvelopeUsd({
      merged,
      layers,
      periodStart: new Date(2026, 5, 21),
      periodEnd: new Date(2026, 5, 21, 23, 59, 59),
    });

    expect(usd).toBe(100);
  });
});

describe("sumOpenAiWaCalibratedEnvelopeUsd", () => {
  it("uplifts only WA-only gap days when unified covers the overlap (~504K → ~571K)", () => {
    const merged = emptyMerged();
    const upliftRatio = 589_900 / 504_908;
    const waDayUsd = (504_908 * OPENAI_CREDIT_OVERAGE_USD) / (20 + 5 * upliftRatio);
    const unifiedDayUsd = waDayUsd * upliftRatio;
    const overlapDays = ["2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"];

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(overlapDays.map((d) => [d, unifiedDayUsd * 0.4])),
      unifiedCodByYmd: new Map(overlapDays.map((d) => [d, unifiedDayUsd * 0.6])),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, waDayUsd] as const;
        }),
      ),
    };

    expect(
      computeWaCreditUpliftRatio({
        layers,
        periodStart: new Date(2026, 5, 1),
        periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      }),
    ).toBeCloseTo(upliftRatio, 2);

    const raw = sumOpenAiPortalAlignedEnvelopeUsd({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });
    const calibrated = sumOpenAiWaCalibratedEnvelopeUsd({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    expect(raw / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(504_908, -2);
    expect(calibrated.totalUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(570_687, -2);
    expect(calibrated.usesUplift).toBe(true);

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });
    expect(portal.source).toBe("unified_credits");
    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(570_687, -2);
  });

  it("uplifts every WA-only day when unified COSTS has not synced (~504K → ~590K)", () => {
    const merged = emptyMerged();
    const waDayUsd = (504_908 * OPENAI_CREDIT_OVERAGE_USD) / 25;

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(),
      unifiedCodByYmd: new Map(),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, waDayUsd] as const;
        }),
      ),
    };

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });
    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(589_900, -2);
    expect(portal.source).toBe("unified_credits");
  });

  it("calibrates when unified period sum is high but early month days are WA-only (~572K → ~590K)", () => {
    const merged = emptyMerged();
    const upliftRatio = 589_900 / 504_908;
    const waDayUsd = 504_908 * OPENAI_CREDIT_OVERAGE_USD / 25;
    const unifiedDayUsd = waDayUsd * upliftRatio;

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(
        Array.from({ length: 20 }, (_, i) => {
          const d = String(i + 6).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.4] as const;
        }),
      ),
      unifiedCodByYmd: new Map(
        Array.from({ length: 20 }, (_, i) => {
          const d = String(i + 6).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.6] as const;
        }),
      ),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, waDayUsd] as const;
        }),
      ),
    };

    expect(
      hasWaOnlyDaysInPeriod({
        layers,
        periodStart: new Date(2026, 5, 1),
        periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      }),
    ).toBe(true);

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(589_900, -2);
    expect(portal.source).toBe("unified_credits");
  });

  it("calibrates with fallback uplift when WA and unified days do not overlap (~561K → ~590K)", () => {
    const merged = emptyMerged();
    const upliftRatio = 589_900 / 504_908;
    const waDayUsd = (504_908 * OPENAI_CREDIT_OVERAGE_USD) / 25;
    const unifiedDayUsd = waDayUsd * upliftRatio;
    const unifiedDays = ["2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"];

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(unifiedDays.map((d) => [d, unifiedDayUsd * 0.4])),
      unifiedCodByYmd: new Map(unifiedDays.map((d) => [d, unifiedDayUsd * 0.6])),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 20 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, waDayUsd] as const;
        }),
      ),
    };

    expect(
      computeWaCreditUpliftRatio({
        layers,
        periodStart: new Date(2026, 5, 1),
        periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      }),
    ).toBeCloseTo(upliftRatio, 2);

    const raw = sumOpenAiPortalAlignedEnvelopeUsd({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });
    expect(raw / OPENAI_CREDIT_OVERAGE_USD).toBeLessThan(570_000);

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(589_900, -2);
    expect(portal.source).toBe("unified_credits");
  });

  it("still calibrates WA-only gap days when unified volume dominates the period", () => {
    const merged = emptyMerged();
    const upliftRatio = 589_900 / 504_908;
    const waDayUsd = (504_908 * OPENAI_CREDIT_OVERAGE_USD) / 25;
    const unifiedDayUsd = waDayUsd * upliftRatio;

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(
        Array.from({ length: 22 }, (_, i) => {
          const d = String(i + 4).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.4] as const;
        }),
      ),
      unifiedCodByYmd: new Map(
        Array.from({ length: 22 }, (_, i) => {
          const d = String(i + 4).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.6] as const;
        }),
      ),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, waDayUsd] as const;
        }),
      ),
    };

    const aligned = sumOpenAiPortalAlignedEnvelopeUsd({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });
    const unifiedShare =
      sumPortalEnvelopeProductUsd({
        merged,
        layers,
        periodStart: new Date(2026, 5, 1),
        periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      }).unifiedUsd / aligned;

    expect(unifiedShare).toBeGreaterThan(0.85);

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    expect(portal.envelopeUsd).toBeGreaterThan(aligned + 0.01);
    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(589_900, -2);
  });

  it("does not re-uplift when every day has unified COSTS (~600.5K portal)", () => {
    const merged = emptyMerged();
    const portalCredits = 600_500;
    const dayUsd = (portalCredits * OPENAI_CREDIT_OVERAGE_USD) / 25;
    const waDayUsd = dayUsd * 0.85;

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, dayUsd * 0.35] as const;
        }),
      ),
      unifiedCodByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, dayUsd * 0.65] as const;
        }),
      ),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, waDayUsd] as const;
        }),
      ),
    };

    expect(
      hasWaOnlyDaysInPeriod({
        layers,
        periodStart: new Date(2026, 5, 1),
        periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      }),
    ).toBe(false);

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(portalCredits, -2);
    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeLessThan(642_391);
    expect(portal.chatgptUsd + portal.codexUsd).toBeCloseTo(portal.envelopeUsd, 2);
    expect(portal.source).toBe("unified_credits");
  });

  it("falls back to WA for a partial unified sync on the last day (Jun 25 sliver)", () => {
    const merged = emptyMerged();
    const upliftRatio = 589_900 / 504_908;
    const waDayUsd = (504_908 * OPENAI_CREDIT_OVERAGE_USD) / 25;
    const unifiedDayUsd = waDayUsd * upliftRatio;
    const partialJun25UnifiedUsd = 399 * OPENAI_CREDIT_OVERAGE_USD;

    const fullUnifiedDays = Array.from({ length: 24 }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return [`2026-06-${d}`, unifiedDayUsd] as const;
    });

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map([
        ...fullUnifiedDays.map(([d, usd]) => [d, usd * 0.4] as const),
        ["2026-06-25", partialJun25UnifiedUsd * 0.4],
      ]),
      unifiedCodByYmd: new Map([
        ...fullUnifiedDays.map(([d, usd]) => [d, usd * 0.6] as const),
        ["2026-06-25", partialJun25UnifiedUsd * 0.6],
      ]),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 25 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, waDayUsd] as const;
        }),
      ),
    };

    const throughJun24 = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 24, 23, 59, 59),
    });
    const throughJun25 = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    const jun24Credits = throughJun24.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD;
    const jun25Credits = throughJun25.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD;
    const day25Delta = jun25Credits - jun24Credits;

    expect(day25Delta).toBeGreaterThan(10_000);
    expect(day25Delta).not.toBeCloseTo(399, -1);
    expect(jun25Credits).toBeCloseTo(589_900, -2);
  });

  it("projects a trailing incomplete day from median unified when WA has not synced", () => {
    const merged = emptyMerged();
    const unifiedDayUsd = 2_000;
    const partialJun25UnifiedUsd = 399 * OPENAI_CREDIT_OVERAGE_USD;
    merged.codex.byYmd.set("2026-06-25", unifiedDayUsd * 0.65);

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.4] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.4],
      ]),
      unifiedCodByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.6] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.6],
      ]),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map(
        Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, 1_500] as const;
        }),
      ),
    };

    const throughJun24 = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 24, 23, 59, 59),
    });
    const throughJun25 = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    expect(
      throughJun25.envelopeUsd - throughJun24.envelopeUsd,
    ).toBeGreaterThan(1_000);
    expect(throughJun25.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeGreaterThan(
      throughJun24.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD + 10_000,
    );
  });

  it("uses median projection over partial WA when unified sync is incomplete", () => {
    const merged = emptyMerged();
    const unifiedDayUsd = 2_000;
    const partialJun25UnifiedUsd = 516;
    const partialWaUsd = 500;
    merged.codex.byYmd.set("2026-06-25", unifiedDayUsd * 0.65);

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.4] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.4],
      ]),
      unifiedCodByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.6] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.6],
      ]),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map([["2026-06-25", partialWaUsd]]),
    };

    const throughJun24 = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 24, 23, 59, 59),
    });
    const throughJun25 = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    const day25Delta = throughJun25.envelopeUsd - throughJun24.envelopeUsd;
    expect(day25Delta).toBeGreaterThan(partialWaUsd);
    expect(day25Delta).toBeCloseTo(unifiedDayUsd, -1);
  });

  it("caps incomplete unified days at median when WA shows a full-day pool mid-sync", () => {
    const merged = emptyMerged();
    const unifiedDayUsd = 2_000;
    const partialJun25UnifiedUsd = 516;
    const fullWaJun25Usd = 3_300;
    const uplift = 1.35;
    merged.codex.byYmd.set("2026-06-25", unifiedDayUsd * 0.65);

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.4] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.4],
      ]),
      unifiedCodByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, unifiedDayUsd * 0.6] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.6],
      ]),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map([["2026-06-25", fullWaJun25Usd]]),
    };

    const periodEnd = new Date(2026, 5, 25, 23, 59, 59);
    const capped = sumPortalEnvelopeProductUsd({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd,
      waGapUplift: uplift,
    });

    expect(capped.totalUsd).toBeCloseTo(unifiedDayUsd * 25, -1);
    expect(capped.totalUsd).toBeLessThan(
      unifiedDayUsd * 24 + Math.max(unifiedDayUsd, fullWaJun25Usd * uplift),
    );
  });

  it("keeps ChatGPT/Codex split aligned with Unified COSTS when Codex EA lags on Jun 25", () => {
    const merged = emptyMerged();
    const portalCredits = 645_717;
    const dayUsd = (portalCredits * OPENAI_CREDIT_OVERAGE_USD) / 25;
    const partialJun25UnifiedUsd = 516;
    const partialCodexEaUsd = 120;
    merged.codex.byYmd.set("2026-06-25", partialCodexEaUsd);

    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, dayUsd * 0.35] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.35],
      ]),
      unifiedCodByYmd: new Map([
        ...Array.from({ length: 24 }, (_, i) => {
          const d = String(i + 1).padStart(2, "0");
          return [`2026-06-${d}`, dayUsd * 0.65] as const;
        }),
        ["2026-06-25", partialJun25UnifiedUsd * 0.65],
      ]),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map([["2026-06-25", dayUsd * 0.85]]),
    };

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });

    const chatShare = portal.chatgptUsd / portal.envelopeUsd;
    const codShare = portal.codexUsd / portal.envelopeUsd;
    expect(portal.chatgptUsd + portal.codexUsd).toBeCloseTo(portal.envelopeUsd, 2);
    expect(chatShare).toBeGreaterThan(0.32);
    expect(chatShare).toBeLessThan(0.38);
    expect(codShare).toBeGreaterThan(0.62);
    expect(codShare).toBeLessThan(0.68);
    expect(volumeWeightedUnifiedCodShare({
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    })).toBeCloseTo(0.65, 2);
  });
});

describe("resolveOpenAiPortalEnvelope", () => {
  it("prefers live org-costs over WA when live total is higher", () => {
    const merged = emptyMerged();
    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(),
      unifiedCodByYmd: new Map(),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map([["2026-06-01", 35_000]]),
    };

    const portal589kUsd = 589_900 * 0.07;
    const r = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      liveOrgCosts: {
        chatgptUsd: portal589kUsd * 0.35,
        codexUsd: portal589kUsd * 0.65,
        totalUsd: portal589kUsd,
      },
    });

    expect(r.source).toBe("org_costs");
    expect(r.envelopeUsd).toBeCloseTo(portal589kUsd, 2);
    expect(r.chatgptUsd + r.codexUsd).toBeCloseTo(portal589kUsd, 2);
  });

  it("prefers unified credits when unified total exceeds org-costs", () => {
    const merged = emptyMerged();
    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map([["2026-06-21", 25_000]]),
      unifiedCodByYmd: new Map([["2026-06-21", 18_000]]),
      orgCostsChatByYmd: new Map([["2026-06-21", 10_000]]),
      orgCostsCodByYmd: new Map([["2026-06-21", 10_000]]),
      workspacePoolByYmd: new Map([["2026-06-21", 5_000]]),
    };

    const r = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 21),
      periodEnd: new Date(2026, 5, 21, 23, 59, 59),
    });

    expect(r.source).toBe("unified_credits");
    expect(r.envelopeUsd).toBe(43_000);
  });
});

describe("dominantOpenAiEnvelopeSource", () => {
  it("returns org_costs when org-costs total exceeds WA", () => {
    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(),
      unifiedCodByYmd: new Map(),
      orgCostsChatByYmd: new Map([["2026-06-01", 2000]]),
      orgCostsCodByYmd: new Map([["2026-06-01", 3000]]),
      workspacePoolByYmd: new Map([["2026-06-01", 1000]]),
    };

    expect(dominantOpenAiEnvelopeSource(layers)).toBe("org_costs");
  });

  it("returns workspace_analytics when only WA has data", () => {
    const layers: OpenAiOrgEnvelopeLayers = {
      unifiedChatByYmd: new Map(),
      unifiedCodByYmd: new Map(),
      orgCostsChatByYmd: new Map(),
      orgCostsCodByYmd: new Map(),
      workspacePoolByYmd: new Map([["2026-06-01", 500]]),
    };
    expect(dominantOpenAiEnvelopeSource(layers)).toBe("workspace_analytics");
  });
});
