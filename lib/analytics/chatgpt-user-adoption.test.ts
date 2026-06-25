import { describe, expect, it, vi, afterEach } from "vitest";
import { mergeUserAnalyticsRows, summarizeChatgptAdoption } from "./chatgpt-user-adoption";
import type { ChatgptUserAnalyticsRow } from "@/lib/integrations/workspace-analytics/types";

describe("chatgpt-user-adoption", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges daily rows and flags dormancy", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
    const rows: ChatgptUserAnalyticsRow[] = [
      {
        event_id: "1",
        event_date: "2026-05-20",
        user_id: "u1",
        email: "a@wdts.com",
        credits_used: 10,
        messages: 5,
        gpt_messages: 3,
        project_messages: 1,
        tool_messages: 1,
        last_day_active: "2026-05-20",
        raw: {},
      },
      {
        event_id: "2",
        event_date: "2026-05-27",
        user_id: "u1",
        email: "a@wdts.com",
        credits_used: 2,
        messages: 1,
        gpt_messages: 1,
        last_day_active: "2026-05-27",
        raw: {},
      },
    ];

    const users = mergeUserAnalyticsRows(rows);
    expect(users).toHaveLength(1);
    expect(users[0]?.creditsUsed).toBe(12);
    expect(users[0]?.dormant).toBe(false);
    expect(users[0]?.lastDayActive).toBe("2026-05-27");

    const summary = summarizeChatgptAdoption(users);
    expect(summary.dormantCount).toBe(0);
    expect(summary.gptShare).toBeGreaterThan(0);
  });
});
