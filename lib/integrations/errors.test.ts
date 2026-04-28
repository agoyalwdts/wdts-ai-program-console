import { describe, expect, it } from "vitest";
import { IntegrationError, NotImplementedError } from "./errors";

describe("NotImplementedError", () => {
  it("includes the integration name and method in the message", () => {
    const e = new NotImplementedError("gateway", "listUsageRecords");
    expect(e.message).toContain("gateway");
    expect(e.message).toContain("listUsageRecords");
    expect(e.client).toBe("gateway");
    expect(e.method).toBe("listUsageRecords");
  });

  it("hints at the synthetic escape hatch", () => {
    const e = new NotImplementedError("cursor", "listSeats");
    expect(e.message).toContain("INTEGRATION_CURSOR=synthetic");
  });
});

describe("IntegrationError", () => {
  it("prefixes the message with the client name", () => {
    const e = new IntegrationError("deel", "API token missing");
    expect(e.message).toBe("[deel] API token missing");
  });
});
