import { describe, expect, it } from "vitest";
import {
  codexUsageRowUserId,
  resolveCodexUsageRowEmail,
} from "./resolve-usage-row-identity";
import type { CodexUsageRow } from "./types";

const baseRow: CodexUsageRow = {
  object: "workspace.codex.usage.result",
  start_time: 1_730_419_200,
  end_time: 1_730_505_600,
  totals: { threads: 1, turns: 2, credits: 3 },
  clients: [],
};

describe("resolveCodexUsageRowEmail", () => {
  it("prefers actor.email over roster lookup", () => {
    const row: CodexUsageRow = {
      ...baseRow,
      user_id: "legacy-id",
      actor: { type: "ACCOUNT_USER", user_id: "uid-1", email: "Dev@wdts.com" },
    };
    expect(resolveCodexUsageRowEmail(row)).toBe("dev@wdts.com");
    expect(codexUsageRowUserId(row)).toBe("uid-1");
  });

  it("maps via userIdToEmail using actor.user_id", () => {
    const map = new Map([["uid-1", "mapped@wdts.com"]]);
    const row: CodexUsageRow = {
      ...baseRow,
      actor: { user_id: "uid-1", email: null },
    };
    expect(resolveCodexUsageRowEmail(row, map)).toBe("mapped@wdts.com");
  });
});
