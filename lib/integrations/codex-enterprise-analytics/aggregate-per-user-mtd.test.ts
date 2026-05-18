import { describe, expect, it } from "vitest";
import {
  aggregateLastActivityEndSecByNormEmail,
  aggregateMtdCreditsByNormEmail,
} from "./aggregate-per-user-mtd";
import type { CodexUsageRow } from "./types";

function row(partial: Partial<CodexUsageRow> & Pick<CodexUsageRow, "start_time" | "end_time">): CodexUsageRow {
  return {
    object: "user.codex.usage.result",
    totals: { threads: 0, turns: 0, credits: 1 },
    clients: [],
    email: "alice@wdts.com",
    ...partial,
  };
}

describe("aggregateMtdCreditsByNormEmail", () => {
  it("sums credits in the month window per email", () => {
    const monthStart = 1_700_000_000;
    const end = monthStart + 2_000_000;
    const rows: CodexUsageRow[] = [
      row({ start_time: monthStart, end_time: monthStart + 86_400, totals: { threads: 0, turns: 0, credits: 10 } }),
      row({
        start_time: monthStart + 86_400,
        end_time: monthStart + 172_800,
        email: "alice@wdts.com",
        totals: { threads: 0, turns: 0, credits: 5 },
      }),
      row({
        start_time: monthStart - 86_400,
        end_time: monthStart,
        email: "alice@wdts.com",
        totals: { threads: 0, turns: 0, credits: 99 },
      }),
      row({
        start_time: monthStart,
        end_time: monthStart + 86_400,
        email: "bob@wdts.com",
        totals: { threads: 0, turns: 0, credits: 3 },
      }),
    ];
    const map = aggregateMtdCreditsByNormEmail({ rows, monthStartSec: monthStart, endSec: end });
    expect(map.get("alice@wdts.com")).toBe(15);
    expect(map.get("bob@wdts.com")).toBe(3);
  });

  it("skips rows without email", () => {
    const t = 1_700_000_000;
    const map = aggregateMtdCreditsByNormEmail({
      rows: [row({ start_time: t, end_time: t + 1, email: null, user_id: "u_1" })],
      monthStartSec: t,
      endSec: t + 10_000,
    });
    expect(map.size).toBe(0);
  });
});

describe("aggregateLastActivityEndSecByNormEmail", () => {
  it("keeps the latest end_time with credits", () => {
    const rows: CodexUsageRow[] = [
      row({ start_time: 100, end_time: 200, totals: { threads: 0, turns: 0, credits: 1 } }),
      row({
        start_time: 300,
        end_time: 500,
        email: "alice@wdts.com",
        totals: { threads: 0, turns: 0, credits: 2 },
      }),
    ];
    const map = aggregateLastActivityEndSecByNormEmail(rows);
    expect(map.get("alice@wdts.com")).toBe(500);
  });
});
