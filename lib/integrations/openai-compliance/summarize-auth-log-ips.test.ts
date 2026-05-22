import { describe, expect, it, vi } from "vitest";

const fetchMocks = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
}));

vi.mock("./fetch", () => ({
  resolveComplianceCredentials: vi.fn(() => ({
    apiKey: "ck",
    principalId: "ws-1",
    scope: "workspaces" as const,
  })),
  listComplianceLogFiles: fetchMocks.list,
  downloadComplianceLogFile: fetchMocks.download,
}));

vi.mock("../env", () => ({
  getIntegrationMode: vi.fn(() => "real"),
}));

describe("summarizeComplianceAuthLogIpsForEmail", () => {
  it("returns distinct IPs from downloaded AUTH_LOG files", async () => {
    fetchMocks.list.mockResolvedValue({
      data: [{ id: "log-1" }],
      has_more: false,
    });
    fetchMocks.download.mockResolvedValue(
      [
        JSON.stringify({ email: "u@wdtablesystems.com", ip_address: "10.0.0.8" }),
        JSON.stringify({ user_email: "u@wdtablesystems.com", ip: "10.0.0.9" }),
      ].join("\n"),
    );

    const { summarizeComplianceAuthLogIpsForEmail } = await import("./summarize-auth-log-ips");
    const summary = await summarizeComplianceAuthLogIpsForEmail({
      email: "u@wdtablesystems.com",
      env: {
        INTEGRATION_OPENAI_COMPLIANCE: "real",
        OPENAI_COMPLIANCE_API_KEY: "k",
        CHATGPT_WORKSPACE_ID: "ws-1",
      },
    });

    expect(summary.available).toBe(true);
    if (summary.available) {
      expect(summary.distinctIps).toEqual(["10.0.0.8", "10.0.0.9"]);
      expect(summary.authEventCount).toBe(2);
      expect(summary.logFilesScanned).toBe(1);
    }
  });
});
