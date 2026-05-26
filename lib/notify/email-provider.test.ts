import { afterEach, describe, expect, it } from "vitest";
import { emailProvider, hasAzureGraphMailCredentials, isEmailConfigured } from "./email-provider";

afterEach(() => {
  delete process.env.EMAIL_PROVIDER;
  delete process.env.GRAPH_MAIL_SENDER;
  delete process.env.AZURE_AD_TENANT_ID;
  delete process.env.AZURE_AD_CLIENT_ID;
  delete process.env.AZURE_AD_CLIENT_SECRET;
  delete process.env.RESEND_API_KEY;
});

describe("emailProvider", () => {
  it("prefers graph when GRAPH_MAIL_SENDER and Azure creds are set", () => {
    process.env.GRAPH_MAIL_SENDER = "console@wdts.com";
    process.env.AZURE_AD_TENANT_ID = "t";
    process.env.AZURE_AD_CLIENT_ID = "c";
    process.env.AZURE_AD_CLIENT_SECRET = "s";
    expect(emailProvider()).toBe("graph");
    expect(isEmailConfigured()).toBe(true);
  });

  it("uses explicit EMAIL_PROVIDER=resend", () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_x";
    expect(emailProvider()).toBe("resend");
    expect(isEmailConfigured()).toBe(true);
  });

  it("reports graph not configured without sender", () => {
    process.env.AZURE_AD_TENANT_ID = "t";
    process.env.AZURE_AD_CLIENT_ID = "c";
    process.env.AZURE_AD_CLIENT_SECRET = "s";
    expect(hasAzureGraphMailCredentials()).toBe(false);
  });
});
