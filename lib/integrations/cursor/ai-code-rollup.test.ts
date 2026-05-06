import { describe, expect, it } from "vitest";
import { rollupAiCodeCommits } from "./ai-code-rollup";

describe("rollupAiCodeCommits", () => {
  it("aggregates daily sources and repo AI share", () => {
    const r = rollupAiCodeCommits([
      {
        repoName: "org/a",
        commitSource: "ide",
        totalLinesAdded: 100,
        tabLinesAdded: 30,
        composerLinesAdded: 60,
        commitTs: "2026-05-01T10:00:00.000Z",
      },
      {
        repoName: "org/a",
        commitSource: "cli",
        totalLinesAdded: 50,
        tabLinesAdded: 10,
        composerLinesAdded: 20,
        commitTs: "2026-05-01T12:00:00.000Z",
      },
      {
        repoName: "org/b",
        commitSource: "cloud",
        totalLinesAdded: 40,
        tabLinesAdded: 5,
        composerLinesAdded: 15,
        commitTs: "2026-05-02T08:00:00.000Z",
      },
    ]);
    expect(r.daily).toHaveLength(2);
    const d1 = r.daily.find((d) => d.dayKey === "2026-05-01");
    expect(d1?.ide).toBe(100);
    expect(d1?.cli).toBe(50);
    expect(d1?.aiPct).toBeCloseTo(((30 + 60 + 10 + 20) / 150) * 100, 5);
    const orgA = r.repos.find((x) => x.repo === "org/a");
    expect(orgA?.aiLines).toBe(30 + 60 + 10 + 20);
    expect(orgA?.totalLines).toBe(150);
    expect(r.totals.commitCount).toBe(3);
    expect(r.totals.aiSharePct).toBeCloseTo(((30 + 60 + 10 + 20 + 5 + 15) / 190) * 100, 5);
  });
});
