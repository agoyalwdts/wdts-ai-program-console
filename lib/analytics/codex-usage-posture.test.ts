import { describe, expect, it } from "vitest";
import {
  aggregateModelCreditsFromBuckets,
  aggregateUserPostureFromBuckets,
  buildCodexUsagePostureView,
  buildUsageBucketsFromRows,
  clipUsageBuckets,
} from "./codex-usage-posture";
import { utcYmdFromUnixSec } from "@/lib/integrations/codex-enterprise-analytics/aggregate-workspace-daily";
import type { CodexUsageRow } from "@/lib/integrations/codex-enterprise-analytics/types";

describe("codex-usage-posture", () => {
  const dayOne = 1_730_419_200;
  const dayTwo = 1_730_505_600;
  const ymdOne = utcYmdFromUnixSec(dayOne);

  const rows: CodexUsageRow[] = [
    {
      object: "workspace.codex.usage.result",
      start_time: dayOne,
      end_time: dayTwo,
      totals: { threads: 1, turns: 2, credits: 10 },
      clients: [],
      actor: { user_id: "u1", email: "a@wdts.com" },
      models: [
        { model: "gpt-5.3-codex", credits: 7 },
        { model: "gpt-5.3-codex-mini", credits: 3 },
      ],
      code_attribution: { lines_added: 120, lines_removed: 5 },
    },
    {
      object: "workspace.codex.usage.result",
      start_time: dayTwo,
      end_time: 1_730_592_000,
      totals: { threads: 1, turns: 1, credits: 4 },
      clients: [],
      actor: { user_id: "u2", email: "b@wdts.com" },
      models: [{ model: "gpt-5.3-codex", credits: 4 }],
      code_attribution: { lines_added: 40, lines_removed: 0 },
    },
  ];

  it("builds usage buckets with models and attribution", () => {
    const buckets = buildUsageBucketsFromRows(rows);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.models[0]?.model).toBe("gpt-5.3-codex");
    expect(buckets[0]?.lines_added).toBe(120);
  });

  it("aggregates model credits and user posture", () => {
    const buckets = buildUsageBucketsFromRows(rows);
    const models = aggregateModelCreditsFromBuckets(buckets);
    expect(models[0]?.model).toBe("gpt-5.3-codex");
    expect(models[0]?.credits).toBe(11);

    const users = aggregateUserPostureFromBuckets(buckets);
    expect(users[0]?.email).toBe("a@wdts.com");
    expect(users[0]?.top_model).toBe("gpt-5.3-codex");
    expect(users[0]?.lines_added).toBe(120);
  });

  it("clips buckets to analytics window", () => {
    const buckets = buildUsageBucketsFromRows(rows);
    const clipped = clipUsageBuckets(buckets, { start: ymdOne, end: ymdOne });
    expect(clipped).toHaveLength(1);
    const view = buildCodexUsagePostureView({
      payload: { usageBuckets: buckets },
      clip: { start: ymdOne, end: ymdOne },
    });
    expect(view?.topUsers).toHaveLength(1);
    expect(view?.topUsers[0]?.email).toBe("a@wdts.com");
  });
});
