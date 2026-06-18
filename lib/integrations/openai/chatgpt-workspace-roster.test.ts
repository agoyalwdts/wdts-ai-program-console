import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadChatGptWorkspaceRosterMembers } from "./chatgpt-workspace-roster";

const mockScim = vi.fn();
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();

vi.mock("./scim-list-users", () => ({
  readOpenAiScimEnv: (env: Record<string, string | undefined>) =>
    env.OPENAI_SCIM_API_TOKEN ? { baseUrl: "https://api.openai.com/scim/v2", token: "t" } : null,
  listOpenAiScimMembers: (...args: unknown[]) => mockScim(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    programVendorExportSnapshot: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

describe("loadChatGptWorkspaceRosterMembers", () => {
  beforeEach(() => {
    mockScim.mockReset();
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
  });

  it("prefers SCIM members when token is configured", async () => {
    mockScim.mockResolvedValue([
      { id: "s1", email: "scim@wdtablesystems.com", displayName: "SCIM User" },
    ]);
    mockFindFirst.mockResolvedValue(null);

    const out = await loadChatGptWorkspaceRosterMembers({
      prisma: (await import("@/lib/prisma")).prisma,
      env: { OPENAI_SCIM_API_TOKEN: "token" },
    });

    expect(out.scimCount).toBe(1);
    expect(out.members[0]?.email).toBe("scim@wdtablesystems.com");
  });

  it("loads members from latest CHATGPT_USERS_CSV snapshot", async () => {
    mockFindFirst.mockResolvedValue({
      payload: {
        users: [
          { email: "csv@wdtablesystems.com", name: "CSV User" },
        ],
      },
    });

    const out = await loadChatGptWorkspaceRosterMembers({
      prisma: (await import("@/lib/prisma")).prisma,
      env: {},
    });

    expect(out.csvSnapshotCount).toBe(1);
    expect(out.members[0]?.email).toBe("csv@wdtablesystems.com");
  });
});
