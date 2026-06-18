import { describe, expect, it } from "vitest";
import { resolveGuardrailFeedStatus } from "./feed-status";

describe("resolveGuardrailFeedStatus", () => {
  it("marks vendor feeds active when Cursor or Codex is real", () => {
    expect(
      resolveGuardrailFeedStatus({
        cursorMode: "real",
        codexMode: "synthetic",
        gatewayMode: "real",
      }).vendorFeedsActive,
    ).toBe(true);
    expect(
      resolveGuardrailFeedStatus({
        cursorMode: "synthetic",
        codexMode: "real",
        gatewayMode: "real",
      }).vendorFeedsActive,
    ).toBe(true);
    expect(
      resolveGuardrailFeedStatus({
        cursorMode: "synthetic",
        codexMode: "synthetic",
        gatewayMode: "real",
      }).vendorFeedsActive,
    ).toBe(false);
  });
});
