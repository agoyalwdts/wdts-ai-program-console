import { describe, expect, it } from "vitest";
import { parseCodexWorkspaceJson } from "./parse-codex-workspace-json";

const SAMPLE = JSON.stringify({
  data: [
    {
      date: "2026-04-06",
      totals: { users: 2, threads: 1, turns: 3, credits: 100.5 },
      clients: [{ client_id: "CODEX_CLI", users: 1, credits: 10 }],
    },
    {
      date: "2026-04-07",
      totals: { users: 3, threads: 2, turns: 4, credits: 50 },
      clients: [],
    },
  ],
});

describe("parseCodexWorkspaceJson", () => {
  it("parses daily totals", () => {
    const p = parseCodexWorkspaceJson(SAMPLE);
    expect(p.days).toHaveLength(2);
    expect(p.days[0]?.credits).toBe(100.5);
    expect(p.days[0]?.clients[0]?.client_id).toBe("CODEX_CLI");
  });
});
