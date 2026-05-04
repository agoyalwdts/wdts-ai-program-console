import { describe, expect, it } from "vitest";
import {
  computeCronSignature,
  computeHmacSha256Signature,
  verifyCronSignature,
  verifyHmacSha256Body,
} from "./auth";

const SECRET = "test-secret-do-not-reuse";

describe("computeCronSignature", () => {
  it("emits the sha256= prefix and is deterministic for a given body+secret", () => {
    const a = computeCronSignature({ rawBody: "{}", secret: SECRET });
    const b = computeCronSignature({ rawBody: "{}", secret: SECRET });
    expect(a).toBe(b);
    expect(a.startsWith("sha256=")).toBe(true);
    expect(a).toHaveLength("sha256=".length + 64);
  });

  it("changes when the body changes", () => {
    const a = computeCronSignature({ rawBody: "{}", secret: SECRET });
    const b = computeCronSignature({ rawBody: "{ }", secret: SECRET });
    expect(a).not.toBe(b);
  });

  it("changes when the secret changes", () => {
    const a = computeCronSignature({ rawBody: "{}", secret: SECRET });
    const b = computeCronSignature({ rawBody: "{}", secret: SECRET + "x" });
    expect(a).not.toBe(b);
  });

  it("computeHmacSha256Signature matches computeCronSignature", () => {
    expect(computeHmacSha256Signature({ rawBody: "{}", secret: SECRET })).toBe(
      computeCronSignature({ rawBody: "{}", secret: SECRET }),
    );
  });
});

describe("verifyCronSignature", () => {
  it("accepts a matching signature with the sha256= prefix", () => {
    const sig = computeCronSignature({ rawBody: "{}", secret: SECRET });
    const v = verifyCronSignature({
      rawBody: "{}",
      signatureHeader: sig,
      secret: SECRET,
    });
    expect(v).toEqual({ ok: true });
  });

  it("accepts a matching signature without the sha256= prefix", () => {
    const sig = computeCronSignature({ rawBody: "{}", secret: SECRET }).replace(
      "sha256=",
      "",
    );
    const v = verifyCronSignature({
      rawBody: "{}",
      signatureHeader: sig,
      secret: SECRET,
    });
    expect(v).toEqual({ ok: true });
  });

  it("rejects a missing header with a stable reason", () => {
    const v = verifyCronSignature({
      rawBody: "{}",
      signatureHeader: null,
      secret: SECRET,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/missing/i);
  });

  it("rejects a wrong-length header", () => {
    const v = verifyCronSignature({
      rawBody: "{}",
      signatureHeader: "sha256=abcd",
      secret: SECRET,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/length/i);
  });

  it("rejects a wrong signature even if the length is correct", () => {
    // 64 hex chars but not the right ones.
    const v = verifyCronSignature({
      rawBody: "{}",
      signatureHeader: "sha256=" + "0".repeat(64),
      secret: SECRET,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/mismatch/i);
  });

  it("rejects when the body has been tampered with", () => {
    const sig = computeCronSignature({ rawBody: "{}", secret: SECRET });
    const v = verifyCronSignature({
      rawBody: '{"dryRun":true}',
      signatureHeader: sig,
      secret: SECRET,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/mismatch/i);
  });
});

describe("verifyHmacSha256Body", () => {
  it("uses custom missing-header reason", () => {
    const v = verifyHmacSha256Body({
      rawBody: "{}",
      signatureHeader: null,
      secret: SECRET,
      missingHeaderReason: "missing x-usage-ingest-signature header",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("missing x-usage-ingest-signature header");
  });
});
