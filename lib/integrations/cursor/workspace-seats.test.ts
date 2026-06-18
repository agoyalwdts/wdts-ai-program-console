import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadCursorWorkspaceSeats } from "./workspace-seats";

const mockPrismaSeats = vi.fn();
const mockTeamAdmin = vi.fn();
const mockScim = vi.fn();
const mockReadScimEnv = vi.fn();

vi.mock("./prisma-cursor-seats", () => ({
  listCursorSeatsFromPrisma: () => mockPrismaSeats(),
}));

vi.mock("./team-admin-members", () => ({
  listTeamAdminMembers: (...args: unknown[]) => mockTeamAdmin(...args),
}));

vi.mock("./scim-list-users", () => ({
  listScimUsers: (...args: unknown[]) => mockScim(...args),
  readScimEnv: (...args: unknown[]) => mockReadScimEnv(...args),
}));

describe("loadCursorWorkspaceSeats", () => {
  beforeEach(() => {
    mockPrismaSeats.mockReset();
    mockTeamAdmin.mockReset();
    mockScim.mockReset();
    mockReadScimEnv.mockReset();
  });

  it("returns synthetic prisma seats when integration is not real", async () => {
    mockPrismaSeats.mockResolvedValue([]);
    const out = await loadCursorWorkspaceSeats({
      env: { INTEGRATION_CURSOR: "synthetic" },
    });
    expect(out.source).toBe("synthetic_prisma");
    expect(out.warnings[0]).toMatch(/not `real`/);
  });

  it("uses Team Admin members and omits prisma seed orphans in real mode", async () => {
    mockPrismaSeats.mockResolvedValue([
      {
        userId: "seed-uuid",
        email: "seed@wdts.com",
        displayName: "Seed User",
        subTier: "POWER",
        lastActivityTs: null,
        idleDays: 99,
        mtdSpendUsd: 0,
      },
    ]);
    mockReadScimEnv.mockReturnValue(null);
    mockTeamAdmin.mockResolvedValue([
      {
        id: "admin-1",
        email: "real@wdtablesystems.com",
        displayName: "Real User",
        active: true,
      },
    ]);

    const out = await loadCursorWorkspaceSeats({
      env: { INTEGRATION_CURSOR: "real", CURSOR_TEAM_ADMIN_API_KEY: "key" },
    });

    expect(out.source).toBe("team_admin");
    expect(out.seats).toHaveLength(1);
    expect(out.seats[0]?.email).toBe("real@wdtablesystems.com");
    expect(out.seats[0]?.userId).toBe("cursor:admin-1");
    expect(out.seats.find((s) => s.email === "seed@wdts.com")).toBeUndefined();
  });

  it("returns unavailable when live APIs yield no members", async () => {
    mockPrismaSeats.mockResolvedValue([
      {
        userId: "seed-uuid",
        email: "seed@wdts.com",
        displayName: "Seed",
        subTier: "STANDARD",
        lastActivityTs: null,
        idleDays: null,
        mtdSpendUsd: 0,
      },
    ]);
    mockReadScimEnv.mockReturnValue(null);
    mockTeamAdmin.mockRejectedValue(new Error("401 unauthorized"));

    const out = await loadCursorWorkspaceSeats({
      env: { INTEGRATION_CURSOR: "real", CURSOR_TEAM_ADMIN_API_KEY: "bad" },
    });

    expect(out.source).toBe("unavailable");
    expect(out.seats).toHaveLength(0);
    expect(out.warnings.some((w) => w.includes("401"))).toBe(true);
  });
});
