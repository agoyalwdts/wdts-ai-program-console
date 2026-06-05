import { describe, expect, it } from "vitest";
import {
  codeReviewRowsToSnapshotPayload,
  perUserUsageRowsToSessionsSnapshotPayload,
  workspaceUsageRowsToSnapshotPayload,
} from "./api-to-snapshot-payload";
import type { CodexReviewsRow, CodexUsageRow } from "./types";

describe("api-to-snapshot-payload", () => {
  it("maps workspace usage rows to chart payload", () => {
    const rows: CodexUsageRow[] = [
      {
        object: "workspace.codex.usage.result",
        start_time: 1_730_419_200,
        end_time: 1_730_505_600,
        totals: { threads: 2, turns: 5, credits: 12 },
        clients: [{ client_id: "CODEX_WEB", credits: 12, turns: 5 }],
      },
    ];
    const p = workspaceUsageRowsToSnapshotPayload(rows);
    expect(p.days[0]?.credits).toBe(12);
    expect(p.source).toBe("codex_enterprise_analytics_api");
  });

  it("maps per-user rows to sessions payload with actor email", () => {
    const rows: CodexUsageRow[] = [
      {
        object: "workspace.codex.usage.result",
        start_time: 1_730_419_200,
        end_time: 1_730_505_600,
        totals: { threads: 1, turns: 1, credits: 4 },
        clients: [],
        actor: { user_id: "u1", email: "a@wdts.com" },
        models: [{ model: "gpt-5.3-codex", credits: 4 }],
        code_attribution: { lines_added: 10, lines_removed: 1 },
      },
    ];
    const p = perUserUsageRowsToSessionsSnapshotPayload(rows);
    expect(p.users[0]?.email).toBe("a@wdts.com");
    expect(p.users[0]?.top_model).toBe("gpt-5.3-codex");
    expect(p.usageBuckets).toHaveLength(1);
    expect(Object.values(p.creditsByDate).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("maps code review rows", () => {
    const rows: CodexReviewsRow[] = [
      {
        object: "workspace.codex.usage.code_reviews.result",
        start_time: 1_730_419_200,
        end_time: 1_730_505_600,
        pull_request_reviews: 10,
        comments: 30,
        comment_details: { p0: 1, p1: 2, p2: 3 },
      },
    ];
    const p = codeReviewRowsToSnapshotPayload(rows);
    expect(p.days[0]?.n_reviews).toBe(10);
    expect(p.days[0]?.severity?.p0).toBe(1);
  });
});
