import { describe, expect, it, vi } from "vitest";
import { listTeamAdminMembers } from "./team-admin-members";

describe("listTeamAdminMembers", () => {
  it("maps active team members and skips removed rows", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          teamMembers: [
            {
              id: 42,
              name: "Alex",
              email: "alex@wdtablesystems.com",
              role: "member",
              isRemoved: false,
            },
            {
              id: 43,
              name: "Former",
              email: "gone@wdtablesystems.com",
              role: "member",
              isRemoved: true,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as typeof fetch;

    const members = await listTeamAdminMembers({
      env: { CURSOR_TEAM_ADMIN_API_KEY: "crsr_test" },
      fetchImpl,
    });

    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe("alex@wdtablesystems.com");
    expect(members[0]?.displayName).toBe("Alex");
  });

  it("returns [] when no API key is configured", async () => {
    expect(await listTeamAdminMembers({ env: {} })).toEqual([]);
  });
});
