import { describe, expect, it } from "vitest";
import {
  unwrapCursorArray,
  parseDauRows,
  parseModelDayRows,
  parseAgentEditsRows,
} from "./cursor-analytics-parse";

describe("cursor-analytics-parse", () => {
  it("unwrapCursorArray reads wrapped data", () => {
    expect(unwrapCursorArray({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(unwrapCursorArray([{ b: 2 }])).toEqual([{ b: 2 }]);
  });

  it("parseDauRows maps fields", () => {
    const rows = parseDauRows({
      data: [
        { date: "2026-04-06", dau: 10, cli_dau: 2, cloud_agent_dau: 1, bugbot_dau: 0 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dau).toBe(10);
  });

  it("parseModelDayRows reads model_breakdown", () => {
    const rows = parseModelDayRows({
      data: [
        {
          date: "2026-04-06",
          model_breakdown: {
            "gpt-5": { messages: 3, users: 2 },
          },
        },
      ],
    });
    expect(rows[0]?.breakdown["gpt-5"]?.messages).toBe(3);
  });

  it("parseAgentEditsRows sums suggested lines when present", () => {
    const rows = parseAgentEditsRows({
      data: [
        {
          event_date: "2026-04-06",
          total_green_lines_suggested: 5,
          total_red_lines_suggested: 7,
          total_suggested_diffs: 99,
        },
      ],
    });
    expect(rows[0]?.total_lines_suggested).toBe(12);
  });
});
