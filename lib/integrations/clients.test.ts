/**
 * Smoke test for the integration factories — confirms each client returns
 * an object with all the expected method names, and that the env switch
 * actually picks a different module for `synthetic` vs `real`.
 */

import { describe, expect, it } from "vitest";
import {
  getAnthropicClient,
  getAzureADClient,
  getAzureOpenAIClient,
  getCursorClient,
  getDeelClient,
  getGatewayClient,
  getM365GraphClient,
  getOpenAIClient,
  getPolicyRepoClient,
} from ".";

describe("client factories return the expected method surface", () => {
  it("gateway", () => {
    const c = getGatewayClient({});
    expect(typeof c.listUsageRecords).toBe("function");
    expect(typeof c.aggregateByUser).toBe("function");
    expect(typeof c.aggregateByProgram).toBe("function");
    expect(typeof c.aggregateByProgramDaily).toBe("function");
    expect(typeof c.topSpenders).toBe("function");
    expect(typeof c.managerQueue).toBe("function");
  });

  it("cursor", () => {
    const c = getCursorClient({});
    expect(typeof c.listSeats).toBe("function");
    expect(typeof c.listWaitlist).toBe("function");
  });

  it("openai", () => {
    const c = getOpenAIClient({});
    expect(typeof c.listChatGptSeats).toBe("function");
    expect(typeof c.listCodexSeats).toBe("function");
  });

  it("anthropic", () => {
    expect(typeof getAnthropicClient({}).listSeats).toBe("function");
  });

  it("m365graph", () => {
    const c = getM365GraphClient({});
    expect(typeof c.listLicenses).toBe("function");
    expect(typeof c.listActivity).toBe("function");
  });

  it("azuread", () => {
    const c = getAzureADClient({});
    expect(typeof c.listUsers).toBe("function");
    expect(typeof c.getUserByEmail).toBe("function");
    expect(typeof c.getManager).toBe("function");
  });

  it("deel", () => {
    const c = getDeelClient({});
    expect(typeof c.listEmployees).toBe("function");
    expect(typeof c.getEmployeeByEmail).toBe("function");
  });

  it("policyrepo", () => {
    const c = getPolicyRepoClient({});
    expect(typeof c.openPullRequest).toBe("function");
    expect(typeof c.getPullRequest).toBe("function");
  });

  it("azureopenai", () => {
    const c = getAzureOpenAIClient({});
    expect(typeof c.listDeployments).toBe("function");
  });
});

describe("real-mode gateway mirrors Postgres UsageRecord", () => {
  it("gateway/real listUsageRecords does not throw (Phase 1 mirror)", async () => {
    const c = getGatewayClient({ INTEGRATION_GATEWAY: "real" });
    const rows = await c.listUsageRecords({
      userId: "00000000-0000-0000-0000-000000000000",
      since: new Date(0),
      until: new Date(),
    });
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe("real-mode clients throw NotImplementedError", () => {
  it("cursor/real falls back to synthetic when SCIM URL or token is missing", async () => {
    const c = getCursorClient({ INTEGRATION_CURSOR: "real" });
    const seats = await c.listSeats();
    expect(Array.isArray(seats)).toBe(true);
  });

  it("openai/real surfaces missing env vars as IntegrationError", async () => {
    // Detailed coverage in lib/integrations/openai/real.test.ts.
    const c = getOpenAIClient({ INTEGRATION_OPENAI: "real" });
    await expect(c.listChatGptSeats()).rejects.toThrow(/OPENAI_ADMIN_API_KEY/);
  });

  it("anthropic/real surfaces missing env vars as IntegrationError", async () => {
    // Detailed coverage in lib/integrations/anthropic/real.test.ts.
    const c = getAnthropicClient({ INTEGRATION_ANTHROPIC: "real" });
    await expect(c.listSeats()).rejects.toThrow(/ANTHROPIC_ADMIN_API_KEY/);
  });

  it("policyrepo/real surfaces missing env vars as IntegrationError", async () => {
    // Real client tries to read POLICYREPO_OWNER/NAME/TOKEN at call-time;
    // with INTEGRATION_POLICYREPO=real and no other env, openPullRequest
    // should fail loudly rather than silently no-op. Detailed coverage is
    // in lib/integrations/policyrepo/real.test.ts (mocked fetch).
    const c = getPolicyRepoClient({ INTEGRATION_POLICYREPO: "real" });
    await expect(
      c.openPullRequest({
        title: "t",
        files: [{ path: "x.yaml", content: "" }],
        decisionId: "d",
        authorEmail: "a@b.c",
      }),
    ).rejects.toThrow(/POLICYREPO_OWNER/);
  });
});

describe("policyrepo/synthetic returns a fake PR shape", () => {
  it("openPullRequest", async () => {
    const c = getPolicyRepoClient({});
    const pr = await c.openPullRequest({
      title: "Promote alice to Codex Power",
      files: [
        { path: "policies/codex.toml", content: "alice@wdts.com = POWER\n" },
      ],
      decisionId: "decision-123",
      authorEmail: "actor@wdts.com",
    });
    expect(pr.state).toBe("OPEN");
    expect(pr.url).toMatch(/example\.wdts\.com\/policies\/pull\/\d+$/);
    expect(pr.branch).toContain("decision-123");
  });
});
