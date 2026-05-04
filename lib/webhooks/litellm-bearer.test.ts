import { describe, expect, it } from "vitest";
import { verifyLiteLLmBearerToken } from "./litellm-bearer";

describe("verifyLiteLLmBearerToken", () => {
  it("accepts exact Bearer match", () => {
    const v = verifyLiteLLmBearerToken({
      authorizationHeader: "Bearer my-secret-value",
      secret: "my-secret-value",
    });
    expect(v).toEqual({ ok: true });
  });

  it("rejects wrong token (same length)", () => {
    const v = verifyLiteLLmBearerToken({
      authorizationHeader: "Bearer aaaaaaaaaaaa",
      secret: "bbbbbbbbbbbb",
    });
    expect(v.ok).toBe(false);
  });
});
