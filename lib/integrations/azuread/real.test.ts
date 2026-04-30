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
  const calls: string[] = [];
  let i = 0;
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const r = responses[i++];
    if (!r) throw new Error("Unexpected extra fetch call to " + url);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
      headers: r.text != null ? {} : { "content-type": "application/json" },
    });
  });
  return calls;
}

describe("realAzureADClient", () => {
  it("listUsers paginates and maps Graph users to IdentityUser", async () => {
    const calls = mockSequence([
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
              manager: null,
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
              manager: null,
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

    // The /users URL uses $expand=manager to avoid an N+1 walk per user.
    // The token call (calls[0]) doesn't, but the directory call (calls[1])
    // must.
    expect(calls[1]).toContain("$expand=manager");
    expect(calls[1]).toContain("$select=id,displayName,mail,userPrincipalName,accountEnabled");
  });

  it("listUsers populates managerEmail from the embedded manager object", async () => {
    mockSequence([
      { json: { access_token: "tok", expires_in: 3600 } },
      {
        json: {
          value: [
            {
              id: "id-rep",
              displayName: "Direct Report",
              mail: "rep@wdts.com",
              userPrincipalName: "rep@wdts.com",
              accountEnabled: true,
              manager: {
                id: "id-boss",
                mail: "boss@wdts.com",
                userPrincipalName: "boss@wdts.com",
              },
            },
            {
              id: "id-top",
              displayName: "Top Of Org",
              mail: "top@wdts.com",
              userPrincipalName: "top@wdts.com",
              accountEnabled: true,
              // No manager — Graph omits the field at the top of the org.
            },
            {
              id: "id-mailless",
              displayName: "Mailless Manager Source",
              mail: "mailless@wdts.com",
              userPrincipalName: "mailless@wdts.com",
              accountEnabled: true,
              manager: {
                id: "id-mgr-noemail",
                mail: null,
                userPrincipalName: "mgr.upn@wdts.com",
              },
            },
          ],
        },
      },
    ]);

    const users = await realAzureADClient.listUsers();
    expect(users[0]?.managerEmail).toBe("boss@wdts.com");
    expect(users[1]?.managerEmail).toBeNull();
    // Fallback: when manager.mail is null, use userPrincipalName.
    expect(users[2]?.managerEmail).toBe("mgr.upn@wdts.com");
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
