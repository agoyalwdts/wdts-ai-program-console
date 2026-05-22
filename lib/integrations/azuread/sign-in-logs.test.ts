import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ENTRA_AI_APP_PATTERNS,
  signInMatchesAiApp,
  summarizeEntraAiSignInIpsForEmail,
} from "./sign-in-logs";

const graphMocks = vi.hoisted(() => ({
  paginate: vi.fn(),
  readConfig: vi.fn(() => ({
    tenantId: "tenant",
    clientId: "client",
    clientSecret: "secret",
  })),
}));

vi.mock("./graph", () => ({
  readGraphConfigFromEnv: graphMocks.readConfig,
  graphPaginate: graphMocks.paginate,
}));

vi.mock("../env", () => ({
  getIntegrationMode: vi.fn((name: string) =>
    name === "azuread" ? "real" : "synthetic",
  ),
}));

describe("signInMatchesAiApp", () => {
  it("matches ChatGPT and OpenAI app names", () => {
    expect(
      signInMatchesAiApp(
        { appDisplayName: "ChatGPT Enterprise" },
        [...DEFAULT_ENTRA_AI_APP_PATTERNS],
      ),
    ).toBe(true);
    expect(
      signInMatchesAiApp({ resourceDisplayName: "OpenAI Codex" }, ["codex"]),
    ).toBe(true);
    expect(signInMatchesAiApp({ appDisplayName: "Microsoft Teams" }, ["chatgpt"])).toBe(
      false,
    );
  });
});

describe("summarizeEntraAiSignInIpsForEmail", () => {
  it("returns unavailable when azuread is synthetic", async () => {
    const { getIntegrationMode } = await import("../env");
    vi.mocked(getIntegrationMode).mockReturnValueOnce("synthetic");
    const summary = await summarizeEntraAiSignInIpsForEmail({
      email: "u@wdtablesystems.com",
    });
    expect(summary.available).toBe(false);
  });

  it("aggregates distinct IPs from Graph sign-ins", async () => {
    graphMocks.paginate.mockImplementation(async function* () {
      yield [
        {
          userPrincipalName: "u@wdtablesystems.com",
          ipAddress: "203.0.113.10",
          appDisplayName: "ChatGPT",
          status: { errorCode: 0 },
        },
        {
          userPrincipalName: "u@wdtablesystems.com",
          ipAddress: "203.0.113.10",
          appDisplayName: "OpenAI Codex",
          status: { errorCode: 0 },
        },
        {
          userPrincipalName: "u@wdtablesystems.com",
          ipAddress: "198.51.100.2",
          appDisplayName: "ChatGPT",
          status: { errorCode: 0 },
        },
        {
          userPrincipalName: "u@wdtablesystems.com",
          ipAddress: "10.0.0.1",
          appDisplayName: "SharePoint",
          status: { errorCode: 0 },
        },
      ];
    });

    const summary = await summarizeEntraAiSignInIpsForEmail({
      email: "u@wdtablesystems.com",
      env: {
        INTEGRATION_AZUREAD: "real",
        AZURE_AD_TENANT_ID: "t",
        AZURE_AD_CLIENT_ID: "c",
        AZURE_AD_CLIENT_SECRET: "s",
      },
    });

    expect(summary.available).toBe(true);
    if (summary.available) {
      expect(summary.distinctIps).toEqual(["198.51.100.2", "203.0.113.10"]);
      expect(summary.signInCount).toBe(3);
      expect(summary.matchedApps).toEqual(["ChatGPT", "OpenAI Codex"]);
    }
  });
});
