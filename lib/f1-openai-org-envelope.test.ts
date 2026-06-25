import { describe, expect, it } from "vitest";
import type { OpenAiDailyMergedSpend } from "./f1-openai-daily-spend";
import {
  computeWaCreditUpliftRatio,
  dominantOpenAiEnvelopeSource,
  resolveOpenAiPortalEnvelope,
  sumOpenAiPortalAlignedEnvelopeUsd,
  sumOpenAiWaCalibratedEnvelopeUsd,
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
  it("scales hybrid envelope by unified/WA overlap uplift (~504K → ~590K credits)", () => {
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
    expect(calibrated.totalUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(589_900, -2);
    expect(calibrated.usesUplift).toBe(true);

    const portal = resolveOpenAiPortalEnvelope({
      merged,
      layers,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });
    expect(portal.source).toBe("unified_credits");
    expect(portal.envelopeUsd / OPENAI_CREDIT_OVERAGE_USD).toBeCloseTo(589_900, -2);
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
