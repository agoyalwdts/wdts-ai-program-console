import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.USER_MODEL_COACHING_EMAIL = "1";
  process.env.APP_ENV = "prod";
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.GUARDRAIL_USER_COACHING_RULE_CODES;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  delete process.env.USER_MODEL_COACHING_EMAIL;
  delete process.env.APP_ENV;
  delete process.env.RESEND_API_KEY;
});

describe("notifyGuardrailAlertUsers", () => {
  it("sends one email per active user and stamps userEmailNotifiedAt", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "em_1" }),
    });

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ email: "dev@wdts.com" }]),
      },
      guardrailPolicyAlert: { updateMany },
    } as unknown as PrismaClient;

    const { notifyGuardrailAlertUsers } = await import("./notify-end-users");

    const summary = await notifyGuardrailAlertUsers({
      prisma,
      alerts: [
        {
          id: "a1",
          userEmail: "dev@wdts.com",
          ruleCode: "NON_COMPLEX_HEAVY_MODEL_SELECTED",
          title: "Heavy model",
          rationale: "Low complexity",
          recommendation: "gpt-5.3",
          product: "CHATGPT",
          model: "gpt-5.5-pro",
        },
      ],
    });

    expect(summary.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1]!.body as string,
    ) as { to: string[]; subject: string };
    expect(body.to).toEqual(["dev@wdts.com"]);
    expect(body.subject).toContain("Model tip");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userEmailNotifiedAt: expect.any(Date) },
      }),
    );
  });

  it("skips disabled users", async () => {
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue([]) },
      guardrailPolicyAlert: { updateMany: vi.fn() },
    } as unknown as PrismaClient;

    const { notifyGuardrailAlertUsers } = await import("./notify-end-users");

    const summary = await notifyGuardrailAlertUsers({
      prisma,
      alerts: [
        {
          id: "a1",
          userEmail: "gone@wdts.com",
          ruleCode: "NON_COMPLEX_HEAVY_MODEL_SELECTED",
          title: "t",
          rationale: "r",
          recommendation: null,
          product: "CHATGPT",
          model: "x",
        },
      ],
    });

    expect(summary.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not email for non-coaching rule codes", async () => {
    const { notifyGuardrailAlertUsers } = await import("./notify-end-users");
    const summary = await notifyGuardrailAlertUsers({
      prisma: { user: { findMany: vi.fn() } } as unknown as PrismaClient,
      alerts: [
        {
          id: "a1",
          userEmail: "dev@wdts.com",
          ruleCode: "UNAPPROVED_MODEL_ENDPOINT",
          title: "t",
          rationale: "r",
          recommendation: null,
          product: "CHATGPT",
          model: "x",
        },
      ],
    });
    expect(summary.attempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
