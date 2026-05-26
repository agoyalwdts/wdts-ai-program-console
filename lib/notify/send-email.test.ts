import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./graph-send", () => ({
  sendGraphHtmlEmail: vi.fn(async () => ({ ok: true, skipped: false, id: "g1" })),
}));

vi.mock("./resend-send", () => ({
  sendResendHtmlEmail: vi.fn(async () => ({ ok: true, skipped: false, id: "r1" })),
}));

afterEach(() => {
  delete process.env.EMAIL_PROVIDER;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("sendHtmlEmail", () => {
  it("routes to Graph when EMAIL_PROVIDER=graph", async () => {
    process.env.EMAIL_PROVIDER = "graph";
    const { sendHtmlEmail } = await import("./send-email");
    const { sendGraphHtmlEmail } = await import("./graph-send");
    const result = await sendHtmlEmail({
      to: ["a@b.com"],
      subject: "s",
      html: "<p>x</p>",
    });
    expect(sendGraphHtmlEmail).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, skipped: false, id: "g1" });
  });

  it("routes to Resend by default", async () => {
    const { sendHtmlEmail } = await import("./send-email");
    const { sendResendHtmlEmail } = await import("./resend-send");
    const result = await sendHtmlEmail({
      to: ["a@b.com"],
      subject: "s",
      html: "<p>x</p>",
    });
    expect(sendResendHtmlEmail).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, skipped: false, id: "r1" });
  });
});
