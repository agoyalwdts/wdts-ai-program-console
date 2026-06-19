import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadCodexLadderSeats } from "./codex-ladder-seats";

const mockPrismaSeats = vi.fn();
const mockOrgMembers = vi.fn();
const mockWorkspaceRoster = vi.fn();
const mockSyntheticList = vi.fn();
const mockSnapshotFindFirst = vi.fn();
const mockUserFindMany = vi.fn();

vi.mock("./prisma-codex-seats", () => ({
  listCodexSeatsFromPrisma: () => mockPrismaSeats(),
  enrichCodexSeatsForDisplay: async (seats: unknown[]) => seats,
}));

vi.mock("./org-users", () => ({
  listOpenAiOrgMembers: (...args: unknown[]) => mockOrgMembers(...args),
}));

vi.mock("./chatgpt-workspace-roster", () => ({
  loadChatGptWorkspaceRosterMembers: (...args: unknown[]) => mockWorkspaceRoster(...args),
}));

vi.mock("./synthetic", () => ({
  syntheticOpenAIClient: {
    listCodexSeats: () => mockSyntheticList(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
    programVendorExportSnapshot: {
      findFirst: (...args: unknown[]) => mockSnapshotFindFirst(...args),
    },
  },
}));

describe("loadCodexLadderSeats", () => {
  beforeEach(() => {
    mockPrismaSeats.mockReset();
    mockOrgMembers.mockReset();
    mockWorkspaceRoster.mockReset();
    mockSyntheticList.mockReset();
    mockSnapshotFindFirst.mockReset();
    mockUserFindMany.mockReset();
    mockUserFindMany.mockResolvedValue([]);
    mockWorkspaceRoster.mockResolvedValue({
      members: [],
      scimCount: 0,
      csvSnapshotCount: 0,
      analyticsSnapshotCount: 0,
      warnings: [],
    });
  });

  it("returns synthetic prisma seats when integrations are not real", async () => {
    mockSyntheticList.mockResolvedValue([
      {
        userId: "seed",
        email: "seed@wdts.com",
        displayName: "Seed",
        subTier: "STANDARD",
        capUsdMonth: 100,
        mtdSpendUsd: 0,
        lastActivityTs: null,
        idleDays: null,
      },
    ]);
    const out = await loadCodexLadderSeats({ env: {} });
    expect(out.source).toBe("synthetic_prisma");
    expect(out.seats).toHaveLength(1);
    expect(out.chatgptWorkspaceSeatCount).toBe(1);
    expect(out.codexActiveSeatCount).toBe(1);
    expect(out.warnings[0]).toMatch(/not `real`/);
  });

  it("uses OpenAI org members and omits prisma seed orphans in real mode", async () => {
    mockPrismaSeats.mockResolvedValue([
      {
        userId: "seed-uuid",
        email: "seed@wdts.com",
        displayName: "Seed User",
        subTier: "POWER",
        capUsdMonth: 2500,
        mtdSpendUsd: 0,
        lastActivityTs: null,
        idleDays: 99,
      },
    ]);
    mockWorkspaceRoster.mockResolvedValue({
      members: [
        { id: "scim-1", email: "real@wdtablesystems.com", displayName: "Real User" },
      ],
      scimCount: 1,
      csvSnapshotCount: 0,
      analyticsSnapshotCount: 0,
      warnings: [],
    });
    mockOrgMembers.mockResolvedValue([]);

    const out = await loadCodexLadderSeats({
      env: {
        INTEGRATION_OPENAI: "real",
        OPENAI_ADMIN_API_KEY: "k",
        OPENAI_ORG_ID: "org",
      },
    });

    expect(out.source).toBe("chatgpt_scim");
    expect(out.seats).toHaveLength(1);
    expect(out.chatgptWorkspaceSeatCount).toBe(1);
    expect(out.codexActiveSeatCount).toBe(0);
    expect(out.seats[0]?.email).toBe("real@wdtablesystems.com");
    expect(out.seats.find((s) => s.email === "seed@wdts.com")).toBeUndefined();
  });

  it("returns unavailable when live roster is empty in real mode", async () => {
    mockPrismaSeats.mockResolvedValue([]);
    mockOrgMembers.mockResolvedValue([]);

    const out = await loadCodexLadderSeats({
      env: {
        INTEGRATION_OPENAI: "real",
        OPENAI_ADMIN_API_KEY: "k",
        OPENAI_ORG_ID: "org",
      },
    });

    expect(out.source).toBe("unavailable");
    expect(out.seats).toHaveLength(0);
    expect(out.chatgptWorkspaceSeatCount).toBe(0);
    expect(out.codexActiveSeatCount).toBe(0);
    expect(out.warnings.some((w) => w.includes("Prisma seed") || w.includes("No live Codex"))).toBe(true);
  });

  it("can build roster from Codex analytics snapshot when org is off", async () => {
    mockPrismaSeats.mockResolvedValue([]);
    mockSnapshotFindFirst.mockResolvedValue({
      payload: {
        usageBuckets: [
          {
            date: "2026-05-20",
            email: "codex@wdtablesystems.com",
            credits: 10,
            models: [{ model: "gpt-5", credits: 10 }],
            lines_added: 0,
            lines_removed: 0,
          },
        ],
      },
      periodStart: new Date("2026-05-16"),
      periodEnd: new Date("2026-05-28"),
      createdAt: new Date(),
      filename: "codex-sessions.json",
    });

    const out = await loadCodexLadderSeats({
      env: {
        INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "real",
        OPENAI_CODEX_ANALYTICS_API_KEY: "k",
        CHATGPT_WORKSPACE_ID: "ws",
      },
    });

    expect(out.source).toBe("codex_analytics_snapshot");
    expect(out.seats).toHaveLength(1);
    expect(out.chatgptWorkspaceSeatCount).toBe(0);
    expect(out.codexActiveSeatCount).toBe(1);
    expect(out.seats[0]?.email).toBe("codex@wdtablesystems.com");
  });
});
