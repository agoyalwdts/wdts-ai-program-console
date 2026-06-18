import { describe, expect, it } from "vitest";
import { CURSOR_DEFAULT_MODEL_ALERT_WHERE } from "./ack-cursor-default-model-alerts";

describe("CURSOR_DEFAULT_MODEL_ALERT_WHERE", () => {
  it("targets open CURSOR default model false positives", () => {
    expect(CURSOR_DEFAULT_MODEL_ALERT_WHERE).toEqual({
      ruleCode: "UNAPPROVED_MODEL_ENDPOINT",
      product: "CURSOR",
      model: { equals: "default", mode: "insensitive" },
      acknowledgedAt: null,
    });
  });
});
