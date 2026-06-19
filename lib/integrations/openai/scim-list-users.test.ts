import { describe, expect, it, vi, beforeEach } from "vitest";
import { listOpenAiScimMembers } from "./scim-list-users";

describe("listOpenAiScimMembers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty when OPENAI_SCIM_API_TOKEN is unset", async () => {
    const out = await listOpenAiScimMembers({ env: {} });
    expect(out).toEqual([]);
  });

  it("returns empty when token is a Key Vault placeholder", async () => {
    const out = await listOpenAiScimMembers({
      env: { OPENAI_SCIM_API_TOKEN: "PLACEHOLDER-OPENAI-SCIM-API-TOKEN" },
    });
    expect(out).toEqual([]);
  });

  it("paginates SCIM Users and maps active members", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          totalResults: 2,
          itemsPerPage: 100,
          startIndex: 1,
          Resources: [
            {
              id: "scim-1",
              userName: "a@wdtablesystems.com",
              displayName: "A User",
              active: true,
              emails: [{ value: "a@wdtablesystems.com", primary: true }],
            },
            {
              id: "scim-2",
              userName: "b@wdtablesystems.com",
              active: true,
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const out = await listOpenAiScimMembers({
      env: { OPENAI_SCIM_API_TOKEN: "scim-token" },
      fetchImpl,
    });

    expect(out).toHaveLength(2);
    expect(out[0]?.email).toBe("a@wdtablesystems.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
