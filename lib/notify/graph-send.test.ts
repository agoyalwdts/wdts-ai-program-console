import { afterEach, describe, expect, it, vi } from "vitest";

const graphPost = vi.fn();

vi.mock("@/lib/integrations/azuread/graph", () => ({
  readGraphConfigFromEnv: vi.fn(() => ({
    tenantId: "tenant",
    clientId: "client",
    clientSecret: "secret",
  })),
  graphPost,
}));

afterEach(() => {
  graphPost.mockReset();
});

describe("sendGraphHtmlEmail", () => {
  it("calls sendMail for the configured mailbox", async () => {
    graphPost.mockResolvedValue(undefined);
    const { sendGraphHtmlEmail } = await import("./graph-send");
    const result = await sendGraphHtmlEmail({
      to: ["user@wdts.com"],
      subject: "Test",
      html: "<p>hi</p>",
      env: {
        GRAPH_MAIL_SENDER: "console@wdts.com",
        AZURE_AD_TENANT_ID: "t",
        AZURE_AD_CLIENT_ID: "c",
        AZURE_AD_CLIENT_SECRET: "s",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && !result.skipped) {
      expect(graphPost).toHaveBeenCalledWith(
        expect.anything(),
        "/users/console%40wdts.com/sendMail",
        expect.objectContaining({
          message: expect.objectContaining({
            subject: "Test",
            toRecipients: [{ emailAddress: { address: "user@wdts.com" } }],
          }),
        }),
      );
    }
  });
});
