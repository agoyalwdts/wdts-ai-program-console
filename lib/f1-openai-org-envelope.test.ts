import { describe, expect, it } from "vitest";
import type { OpenAiDailyMergedSpend } from "./f1-openai-daily-spend";
import {
  dominantOpenAiEnvelopeSource,
  sumOpenAiPortalAlignedEnvelopeUsd,
  type OpenAiOrgEnvelopeLayers,
} from "./f1-openai-org-envelope";

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
