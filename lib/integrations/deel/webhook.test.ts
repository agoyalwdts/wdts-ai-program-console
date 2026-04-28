import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseDeelWebhook, verifyDeelSignature } from "./webhook";

function signed(body: string, secret: string, withPrefix = true): string {
  const hex = createHmac("sha256", secret).update(body, "utf-8").digest("hex");
  return withPrefix ? `sha256=${hex}` : hex;
}

describe("verifyDeelSignature", () => {
  const secret = "wh-secret-test";
  const body = '{"event_type":"employee.updated","data":{"email":"a@w.com"}}';

  it("accepts a valid sha256= prefixed signature", () => {
    expect(
      verifyDeelSignature({
        rawBody: body,
        signatureHeader: signed(body, secret, true),
        secret,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts a bare hex signature (no prefix)", () => {
    expect(
      verifyDeelSignature({
        rawBody: body,
        signatureHeader: signed(body, secret, false),
        secret,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a wrong signature with a stable reason", () => {
    const result = verifyDeelSignature({
      rawBody: body,
      signatureHeader: "sha256=00".repeat(32),
      secret,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/mismatch/i);
  });

  it("rejects when secret differs", () => {
    const sig = signed(body, "different-secret", true);
    const result = verifyDeelSignature({
      rawBody: body,
      signatureHeader: sig,
      secret,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when header is missing", () => {
    const result = verifyDeelSignature({
      rawBody: body,
      signatureHeader: null,
      secret,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing/i);
  });

  it("rejects when header is the wrong length (constant-time guard)", () => {
    const result = verifyDeelSignature({
      rawBody: body,
      signatureHeader: "sha256=abcd",
      secret,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/length/i);
  });

  it("is sensitive to body bytes (not the parsed JSON)", () => {
    const bodyA = '{"x":1}';
    const bodyB = '{"x": 1}'; // semantically equal, byte-different
    const sig = signed(bodyA, secret, true);
    expect(verifyDeelSignature({ rawBody: bodyA, signatureHeader: sig, secret })).toEqual({
      ok: true,
    });
    expect(verifyDeelSignature({ rawBody: bodyB, signatureHeader: sig, secret }).ok).toBe(false);
  });
});

describe("parseDeelWebhook", () => {
  it("maps employee.hired -> EMPLOYEE_HIRED", () => {
    const event = parseDeelWebhook({
      event_type: "employee.hired",
      data: {
        email: "alice@wdts.com",
        full_name: "Alice",
        seniority: "engineer",
        country: "AU",
        status: "active",
      },
    });
    expect(event?.type).toBe("EMPLOYEE_HIRED");
    expect(event?.email).toBe("alice@wdts.com");
    expect(event?.payload.roleTag).toBe("engineer");
    expect(event?.receivedAt).toBeInstanceOf(Date);
  });

  it("maps employee.terminated -> EMPLOYEE_TERMINATED", () => {
    const event = parseDeelWebhook({
      type: "Employee.Terminated",
      data: { resource: { email: "bob@wdts.com", status: "terminated" } },
    });
    expect(event?.type).toBe("EMPLOYEE_TERMINATED");
    expect(event?.payload.status).toBe("TERMINATED");
  });

  it("maps employee.updated -> EMPLOYEE_UPDATED", () => {
    const event = parseDeelWebhook({
      event_type: "employee.changed",
      data: { email: "c@w.com", manager_email: "boss@w.com", status: "active" },
    });
    expect(event?.type).toBe("EMPLOYEE_UPDATED");
    expect(event?.payload.managerEmail).toBe("boss@w.com");
  });

  it("returns null on unknown event types", () => {
    expect(
      parseDeelWebhook({
        event_type: "contract.signed",
        data: { email: "x@w.com" },
      }),
    ).toBeNull();
  });

  it("returns null when no email is present", () => {
    expect(
      parseDeelWebhook({
        event_type: "employee.updated",
        data: { full_name: "no email here" },
      }),
    ).toBeNull();
  });
});
