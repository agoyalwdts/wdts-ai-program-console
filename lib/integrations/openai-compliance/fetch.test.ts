import { describe, expect, it } from "vitest";
import {
  resolveComplianceCredentials,
  resolveUnifiedCreditsComplianceCredentials,
} from "./fetch";

describe("resolveComplianceCredentials", () => {
  it("uses workspace scope for workspace id", () => {
    expect(
      resolveComplianceCredentials({
        OPENAI_COMPLIANCE_API_KEY: "k",
        CHATGPT_WORKSPACE_ID: "152420ca-b38f-4040-9346-e704aaa63ed5",
      }),
    ).toEqual({
      apiKey: "k",
      principalId: "152420ca-b38f-4040-9346-e704aaa63ed5",
      scope: "workspaces",
    });
  });
});

describe("resolveUnifiedCreditsComplianceCredentials", () => {
  it("uses organization scope with OPENAI_ORG_ID", () => {
    expect(
      resolveUnifiedCreditsComplianceCredentials({
        OPENAI_COMPLIANCE_API_KEY: "k",
        OPENAI_ORG_ID: "org-X9osl0XzLOGy74ZOurrq02Zg",
      }),
    ).toEqual({
      apiKey: "k",
      principalId: "org-X9osl0XzLOGy74ZOurrq02Zg",
      scope: "organizations",
    });
  });

  it("returns null without org id", () => {
    expect(
      resolveUnifiedCreditsComplianceCredentials({
        OPENAI_COMPLIANCE_API_KEY: "k",
        CHATGPT_WORKSPACE_ID: "ws",
      }),
    ).toBeNull();
  });
});
