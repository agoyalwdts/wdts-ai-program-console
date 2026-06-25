import { describe, expect, it, vi } from "vitest";
import { fetchOpenAiAuditLogsSince } from "./admin-audit-logs";

vi.mock("../_http", () => ({
  jsonGet: vi.fn(),
}));

describe("fetchOpenAiAuditLogsSince", () => {
  it("paginates audit log list", async () => {
    const { jsonGet } = await import("../_http");
    const mockGet = vi.mocked(jsonGet);
    mockGet
      .mockResolvedValueOnce({
        data: [{ id: "a1", type: "login.succeeded", effective_at: 100 }],
        has_more: true,
        last_id: "a1",
      })
      .mockResolvedValueOnce({
        data: [{ id: "a2", type: "user.updated" }],
        has_more: false,
      });

    const events = await fetchOpenAiAuditLogsSince({
      env: { OPENAI_ADMIN_API_KEY: "sk", OPENAI_ORG_ID: "org-1" },
      maxPages: 2,
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("login.succeeded");
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
