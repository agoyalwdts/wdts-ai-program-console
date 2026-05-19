import { describe, expect, it } from "vitest";
import { aggregateWorkspaceUsageSpendByLocalYmd } from "./aggregate-workspace-daily";
import type { CodexUsageRow } from "./types";

describe("aggregateWorkspaceUsageSpendByLocalYmd", () => {
  it("sums credits per UTC day and converts to USD", () => {
    const rows: CodexUsageRow[] = [
      {
        object: "workspace.codex.usage.result",
        start_time: 1_730_419_200,
        end_time: 1_730_505_600,
        totals: { threads: 0, turns: 0, credits: 10 },
        clients: [],
      },
      {
        object: "workspace.codex.usage.result",
        start_time: 1_730_419_200,
        end_time: 1_730_505_600,
        totals: { threads: 0, turns: 0, credits: 5 },
        clients: [],
      },
    ];
    const map = aggregateWorkspaceUsageSpendByLocalYmd(rows, 0.1);
    expect(map.size).toBe(1);
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(1.5);
  });
});
