import { describe, expect, it } from "vitest";
import { parseCodexSessionsJson } from "./parse-codex-sessions-json";

describe("parseCodexSessionsJson", () => {
  it("aggregates credit_total by date and by user email", () => {
    const json = JSON.stringify({
      data: [
        { date: "2026-05-01", email: "Ada@Example.com", credit_total: 10 },
        { date: "2026-05-01", email: "ada@example.com", credit_total: 3 },
        { date: "2026-05-02", email: "bob@example.com", credit_total: 5 },
      ],
    });
    const p = parseCodexSessionsJson(json);
    expect(p.creditsByDate["2026-05-01"]).toBe(13);
    expect(p.creditsByDate["2026-05-02"]).toBe(5);
    expect(p.userCount).toBe(2);
    expect(p.rowCount).toBe(3);
    const ada = p.users.find((u) => u.email === "ada@example.com");
    expect(ada?.credits_used).toBe(13);
    const bob = p.users.find((u) => u.email === "bob@example.com");
    expect(bob?.credits_used).toBe(5);
  });
});
