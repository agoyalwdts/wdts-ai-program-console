import { describe, expect, it } from "vitest";
import { MODEL_ALLOWLIST } from "@/lib/guardrails/day-one-defaults";
import { cursorModelPassesAllowlist } from "./ack-cursor-allowlist-false-positives";

describe("cursorModelPassesAllowlist", () => {
  it("allows composer and default Cursor model labels", () => {
    for (const model of ["default", "auto", "composer-2.5", "composer-2.5-fast"]) {
      expect(cursorModelPassesAllowlist(model)).toBe(true);
      expect(MODEL_ALLOWLIST.CURSOR.test(model)).toBe(true);
    }
  });

  it("rejects models still outside policy", () => {
    expect(cursorModelPassesAllowlist("agent_review")).toBe(false);
    expect(cursorModelPassesAllowlist("grok-4.3")).toBe(false);
  });
});
