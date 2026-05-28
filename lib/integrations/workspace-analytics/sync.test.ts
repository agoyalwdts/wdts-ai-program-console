import { describe, expect, it, vi } from "vitest";
import { syncWorkspaceAnalytics } from "./sync";

vi.mock("../openai-compliance/fetch", () => ({
  resolveComplianceCredentials: vi.fn(() => ({
    apiKey: "sk-test",
    principalId: "ws-1",
    scope: "workspaces" as const,
  })),
  listComplianceLogFiles: vi.fn(async () => ({
    data: [{ id: "file-1", end_time: "2026-05-27T12:00:00Z" }],
    has_more: false,
    last_end_time: "2026-05-27T12:00:00Z",
  })),
  downloadComplianceLogFile: vi.fn(async () =>
    [
      JSON.stringify({
        event_id: "evt-user-1",
        type: "CHATGPT_USER_ANALYTICS",
        event_date: "2026-05-27",
        user_id: "u-1",
        email: "a@wdtablesystems.com",
        credits_used: 5,
        messages: 2,
      }),
    ].join("\n"),
  ),
}));

describe("syncWorkspaceAnalytics", () => {
  it("returns not configured when compliance integration is synthetic", async () => {
    const out = await syncWorkspaceAnalytics({} as never, {
      actorEmail: "test@wdts.com",
      env: { INTEGRATION_OPENAI_COMPLIANCE: "synthetic" },
      skipDecision: true,
    });
    expect(out.ok).toBe(false);
  });
});
