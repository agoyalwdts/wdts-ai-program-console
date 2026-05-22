import { describe, expect, it } from "vitest";
import {
  INTEGRATION_NAMES,
  getAllIntegrationModes,
  getIntegrationMode,
} from "./env";
import { IntegrationError } from "./errors";

describe("integration env parsing", () => {
  it("defaults every integration to 'synthetic' when the env var is unset", () => {
    const modes = getAllIntegrationModes({});
    for (const name of INTEGRATION_NAMES) {
      expect(modes[name]).toBe("synthetic");
    }
  });

  it("treats empty string as unset (synthetic)", () => {
    expect(getIntegrationMode("gateway", { INTEGRATION_GATEWAY: "" })).toBe("synthetic");
  });

  it("parses 'real' (case-insensitive)", () => {
    expect(getIntegrationMode("gateway", { INTEGRATION_GATEWAY: "real" })).toBe("real");
    expect(getIntegrationMode("cursor", { INTEGRATION_CURSOR: "REAL" })).toBe("real");
  });

  it("throws IntegrationError on garbage values", () => {
    expect(() =>
      getIntegrationMode("gateway", { INTEGRATION_GATEWAY: "yes" }),
    ).toThrow(IntegrationError);
  });

  it("includes every integration name in INTEGRATION_NAMES", () => {
    expect(INTEGRATION_NAMES).toEqual(
      expect.arrayContaining([
        "gateway",
        "cursor",
        "openai",
        "codexenterprise",
        "openaicompliance",
        "anthropic",
        "m365graph",
        "azuread",
        "deel",
        "policyrepo",
        "azureopenai",
      ]),
    );
    expect(INTEGRATION_NAMES).toHaveLength(11);
  });
});
