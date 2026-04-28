/**
 * Unit tests for the real m365graph client. Reuses the same `fetch`-mock
 * pattern as `lib/integrations/azuread/real.test.ts` so each Graph call
 * is a recorded HTTP transaction we can assert on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTokenCacheForTests } from "../azuread/graph";
import { realM365GraphClient } from "./real";

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
  delete process.env.M365_COPILOT_SKU_IDS;
});

function mockSequence(
  responses: Array<{ status?: number; json?: unknown; text?: string }>,
) {
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

describe("realM365GraphClient.listLicenses", () => {
  it("queries /users with assignedLicenses filter and de-dupes across SKUs", async () => {
    mockSequence([
      { json: { access_token: "tok", expires_in: 3600 } },
      {
        json: {
          value: [
            {
              id: "id-1",
              mail: "alice@wdts.com",
              userPrincipalName: "alice@wdts.com",
              assignedLicenses: [{ skuId: "639dec6b-bb19-468b-871c-c5c441c4b0cb" }],
            },
            {
              id: "id-2",
              mail: null,
              userPrincipalName: "bob@wdts.com",
              assignedLicenses: [{ skuId: "639dec6b-bb19-468b-871c-c5c441c4b0cb" }],
            },
          ],
        },
      },
    ]);

    const ls = await realM365GraphClient.listLicenses();
    expect(ls).toHaveLength(2);
    expect(ls[0]).toEqual({ userId: "id-1", email: "alice@wdts.com", flag: null });
    // mail null → falls back to UPN.
    expect(ls[1]).toEqual({ userId: "id-2", email: "bob@wdts.com", flag: null });
  });

  it("respects the M365_COPILOT_SKU_IDS env override (multiple SKUs)", async () => {
    process.env.M365_COPILOT_SKU_IDS = "sku-A, sku-B";
    const calls: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      // Token + two pages (one per SKU).
      if (url.includes("login.microsoftonline.com")) {
        return new Response(
          JSON.stringify({ access_token: "tok", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          value: url.includes("sku-A")
            ? [
                {
                  id: "shared",
                  mail: "x@wdts.com",
                  userPrincipalName: "x@wdts.com",
                  assignedLicenses: [{ skuId: "sku-A" }],
                },
              ]
            : [
                {
                  id: "shared", // duplicate -> deduped
                  mail: "x@wdts.com",
                  userPrincipalName: "x@wdts.com",
                  assignedLicenses: [{ skuId: "sku-B" }],
                },
                {
                  id: "fresh",
                  mail: "y@wdts.com",
                  userPrincipalName: "y@wdts.com",
                  assignedLicenses: [{ skuId: "sku-B" }],
                },
              ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const ls = await realM365GraphClient.listLicenses();
    expect(ls.map((l) => l.userId)).toEqual(["shared", "fresh"]);
    // Two filtered queries — one per SKU.
    expect(calls.filter((c) => c.includes("/users?")).length).toBe(2);
    expect(calls.some((c) => c.includes("sku-A"))).toBe(true);
    expect(calls.some((c) => c.includes("sku-B"))).toBe(true);
  });

  it("propagates 403 with admin-consent guidance", async () => {
    mockSequence([
      { json: { access_token: "tok", expires_in: 3600 } },
      { status: 403, text: "Forbidden" },
    ]);
    await expect(realM365GraphClient.listLicenses()).rejects.toThrow(
      /Reports\.Read\.All|Directory\.Read\.All|admin consent/i,
    );
  });
});

describe("realM365GraphClient.listActivity", () => {
  it("rounds the requested window up to the closest report period", async () => {
    const calls: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url.includes("login.microsoftonline.com")) {
        return new Response(
          JSON.stringify({ access_token: "tok", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const since = new Date("2026-04-01T00:00:00Z");
    const until = new Date("2026-04-08T00:00:00Z"); // 7 days
    await realM365GraphClient.listActivity({ since, until });

    const reportCall = calls.find((c) => c.includes("getMicrosoft365CopilotUsageUserDetail"));
    expect(reportCall).toBeDefined();
    expect(reportCall).toContain("period='D7'");
  });

  it("rounds 28 days up to D30", async () => {
    const calls: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url.includes("login.microsoftonline.com")) {
        return new Response(
          JSON.stringify({ access_token: "tok", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const since = new Date("2026-04-01T00:00:00Z");
    const until = new Date("2026-04-29T00:00:00Z"); // 28 days
    await realM365GraphClient.listActivity({ since, until });
    expect(calls.find((c) => c.includes("D30"))).toBeDefined();
  });

  it("maps last-activity-dates inside the window to feature counts of 1", async () => {
    const since = new Date("2026-04-01T00:00:00Z");
    const until = new Date("2026-04-30T00:00:00Z");
    mockSequence([
      { json: { access_token: "tok", expires_in: 3600 } },
      {
        json: {
          value: [
            {
              userPrincipalName: "alice@wdts.com",
              reportRefreshDate: "2026-04-29",
              lastActivityDate: "2026-04-15",
              wordCopilotLastActivityDate: "2026-04-10", // in window
              excelCopilotLastActivityDate: null, // never
              powerPointCopilotLastActivityDate: "2025-01-01", // before window
              outlookCopilotLastActivityDate: "2026-04-25",
              teamsCopilotLastActivityDate: "2026-04-30",
              oneNoteCopilotLastActivityDate: null,
              copilotChatLastActivityDate: "2026-04-29",
            },
          ],
        },
      },
    ]);

    const out = await realM365GraphClient.listActivity({ since, until });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      userId: "alice@wdts.com",
      periodStart: since,
      features: {
        word: 1,
        excel: 0,
        powerpoint: 0,
        outlook: 1,
        teams: 1,
        onenote: 0,
        chat: 1,
      },
    });
  });

  it("rejects since > until", async () => {
    mockSequence([{ json: { access_token: "tok", expires_in: 3600 } }]);
    await expect(
      realM365GraphClient.listActivity({
        since: new Date("2026-05-01"),
        until: new Date("2026-04-01"),
      }),
    ).rejects.toThrow(/until.*since/i);
  });
});
