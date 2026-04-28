/**
 * Unit tests for the real azuread client. fetch is mocked; no live
 * Microsoft Graph calls. A separate "live" probe (the /settings widget
 * in PR 10) verifies real connectivity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realAzureADClient } from "./real";
import { _resetTokenCacheForTests } from "./graph";

const ENV = {
  AZURE_AD_TENANT_ID: "tenant",
  AZURE_AD_CLIENT_ID: "client",
  AZURE_AD_CLIENT_SECRET: "secret",
};

beforeEach(() => {
  _resetTokenCacheForTests();
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

function mockSequence(responses: Array<{ ok?: boolean; status?: number; json?: unknown; text?: string }>) {
  let i = 0;
  vi.spyOn(global, "fetch").mockImplementation(async () => {
    const r = responses[i++];
    if (!r) throw new Error("Unexpected extra fetch call");
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
      headers: r.text != null ? {} : { "content-type": "application/json" },
    });
  });
}

describe("realAzureADClient", () => {
  it("listUsers paginates and maps Graph users to IdentityUser", async () => {
    mockSequence([
      // token
      { json: { access_token: "tok", expires_in: 3600 } },
      // first page with nextLink
      {
        json: {
          value: [
            {
              id: "id-1",
              displayName: "Anuj Goyal",
              mail: "anuj@wdts.com",
              userPrincipalName: "anuj@wdts.com",
              accountEnabled: true,
            },
          ],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=abc",
        },
      },
      // second page no nextLink
      {
        json: {
          value: [
            {
              id: "id-2",
              displayName: "Suspended User",
              mail: null,
              userPrincipalName: "suspended@wdts.com",
              accountEnabled: false,
            },
          ],
        },
      },
    ]);

    const users = await realAzureADClient.listUsers();
    expect(users).toEqual([
      {
        email: "anuj@wdts.com",
        displayName: "Anuj Goyal",
        azureObjectId: "id-1",
        managerEmail: null,
        status: "ACTIVE",
      },
      {
        email: "suspended@wdts.com",
        displayName: "Suspended User",
        azureObjectId: "id-2",
        managerEmail: null,
        status: "SUSPENDED",
      },
    ]);
  });

  it("getUserByEmail returns null on 404", async () => {
    mockSequence([
      { json: { access_token: "tok", expires_in: 3600 } },
      { status: 404, text: "" },
    ]);
    const u = await realAzureADClient.getUserByEmail("missing@wdts.com");
    expect(u).toBeNull();
  });

  it("getUserByEmail populates managerEmail by following the manager link", async () => {
    mockSequence([
      { json: { access_token: "tok", expires_in: 3600 } },
      // /users/{upn}
      {
        json: {
          id: "id-1",
          displayName: "Anuj Goyal",
          mail: "anuj@wdts.com",
          userPrincipalName: "anuj@wdts.com",
          accountEnabled: true,
        },
      },
      // /users/{upn}/manager
      {
        json: {
          id: "id-mgr",
          displayName: "The Boss",
          mail: "boss@wdts.com",
          userPrincipalName: "boss@wdts.com",
          accountEnabled: true,
        },
      },
    ]);
    const u = await realAzureADClient.getUserByEmail("anuj@wdts.com");
    expect(u?.managerEmail).toBe("boss@wdts.com");
  });

  it("surfaces a helpful error on 403 (admin consent missing)", async () => {
    mockSequence([
      { json: { access_token: "tok", expires_in: 3600 } },
      { status: 403, text: '{"error":{"code":"Authorization_RequestDenied"}}' },
    ]);
    await expect(realAzureADClient.listUsers()).rejects.toThrow(/admin consent/);
  });

  it("throws if env vars are missing", async () => {
    delete process.env.AZURE_AD_CLIENT_SECRET;
    await expect(realAzureADClient.listUsers()).rejects.toThrow(/Missing AZURE_AD_/);
  });
});
