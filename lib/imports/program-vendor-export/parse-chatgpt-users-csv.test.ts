import { describe, expect, it } from "vitest";
import { parseChatgptUsersCsv } from "./parse-chatgpt-users-csv";

const SAMPLE = `cadence,period_start,period_end,email,name,credits_used,messages,user_status,messages_rank
Date Range,2026-04-05,2026-04-07,a@example.com,Alice,30,10,enabled,1
Date Range,2026-04-05,2026-04-07,b@example.com,Bob,60,20,enabled,2
`;

describe("parseChatgptUsersCsv", () => {
  it("sums credits and keeps user rows", () => {
    const p = parseChatgptUsersCsv(SAMPLE);
    expect(p.periodStart).toBe("2026-04-05");
    expect(p.periodEnd).toBe("2026-04-07");
    expect(p.rows).toHaveLength(2);
    expect(p.totalCredits).toBe(90);
    expect(p.totalMessages).toBe(30);
  });
});
