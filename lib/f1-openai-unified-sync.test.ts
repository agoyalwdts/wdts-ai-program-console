import { describe, expect, it } from "vitest";
import { OPENAI_CREDIT_OVERAGE_USD } from "./program";
import {
  incompleteUnifiedDayYmds,
  isIncompleteUnifiedDaySync,
  medianCompleteUnifiedDayUsd,
} from "./f1-openai-unified-sync";

describe("isIncompleteUnifiedDaySync", () => {
  it("flags a sliver even when WA has not synced for that day yet", () => {
    const partialUnifiedUsd = 399 * OPENAI_CREDIT_OVERAGE_USD;
    expect(isIncompleteUnifiedDaySync(partialUnifiedUsd, 0)).toBe(true);
  });

  it("flags a sliver unified row when WA already shows a full day", () => {
    const partialUnifiedUsd = 399 * OPENAI_CREDIT_OVERAGE_USD;
    const waDayUsd = (504_908 * OPENAI_CREDIT_OVERAGE_USD) / 25;
    expect(isIncompleteUnifiedDaySync(partialUnifiedUsd, waDayUsd)).toBe(true);
  });

  it("trusts unified when it matches most of the WA pool", () => {
    expect(isIncompleteUnifiedDaySync(1_500, 2_000)).toBe(false);
  });
});

describe("medianCompleteUnifiedDayUsd", () => {
  it("returns median of complete unified days excluding the incomplete trailing day", () => {
    const dayUsd = 2_000;
    const partialUsd = 399 * OPENAI_CREDIT_OVERAGE_USD;
    const unifiedChat = new Map<string, number>();
    const unifiedCod = new Map<string, number>();
    for (let i = 1; i <= 24; i++) {
      const d = String(i).padStart(2, "0");
      unifiedChat.set(`2026-06-${d}`, dayUsd * 0.4);
      unifiedCod.set(`2026-06-${d}`, dayUsd * 0.6);
    }
    unifiedChat.set("2026-06-25", partialUsd * 0.4);
    unifiedCod.set("2026-06-25", partialUsd * 0.6);

    const median = medianCompleteUnifiedDayUsd({
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      unifiedChatByYmd: unifiedChat,
      unifiedCodByYmd: unifiedCod,
      workspacePoolByYmd: new Map(),
      excludeYmd: "2026-06-25",
    });

    expect(median).toBeCloseTo(dayUsd, 2);
  });
});

describe("incompleteUnifiedDayYmds", () => {
  it("includes trailing days with sub-threshold unified totals", () => {
    const partialUsd = 399 * OPENAI_CREDIT_OVERAGE_USD;
    const skip = incompleteUnifiedDayYmds({
      periodStart: new Date(2026, 5, 25),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      unifiedChatByYmd: new Map([["2026-06-25", partialUsd]]),
      unifiedCodByYmd: new Map(),
      workspacePoolByYmd: new Map(),
    });
    expect(skip.has("2026-06-25")).toBe(true);
  });
});
