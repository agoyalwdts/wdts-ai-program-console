import { describe, expect, it } from "vitest";
import { mergeOrgUsersWithPrismaCodexSeats } from "./merge-org-prisma-codex-seats";
import type { CodexSeat } from "./types";

describe("mergeOrgUsersWithPrismaCodexSeats", () => {
  it("prefers Prisma license row when email matches org member", () => {
    const prismaSeats: CodexSeat[] = [
      {
        userId: "u-db",
        email: "Ada@x.com",
        displayName: "Ada",
        subTier: "POWER",
        capUsdMonth: 2500,
        mtdSpendUsd: 9,
        lastActivityTs: null,
        idleDays: 1,
      },
    ];
    const merged = mergeOrgUsersWithPrismaCodexSeats({
      orgMembers: [{ id: "ou_1", email: "ada@x.com", displayName: "Ada API" }],
      prismaSeats,
      dashboardUserIdByNormEmail: new Map(),
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.subTier).toBe("POWER");
    expect(merged[0]?.userId).toBe("u-db");
  });

  it("appends org-only members as STANDARD then leftover licensed users not in org", () => {
    const prismaSeats: CodexSeat[] = [
      {
        userId: "lic-1",
        email: "a@x.com",
        displayName: "A",
        subTier: "LIGHT",
        capUsdMonth: 1000,
        mtdSpendUsd: 0,
        lastActivityTs: null,
        idleDays: null,
      },
      {
        userId: "lic-2",
        email: "orphan@x.com",
        displayName: "O",
        subTier: "DISCOVERY",
        capUsdMonth: 75,
        mtdSpendUsd: 0,
        lastActivityTs: null,
        idleDays: null,
      },
    ];
    const dash = new Map<string, string>([["b@x.com", "u-b"]]);
    const merged = mergeOrgUsersWithPrismaCodexSeats({
      orgMembers: [
        { id: "ou_a", email: "a@x.com", displayName: "A" },
        { id: "ou_b", email: "b@x.com", displayName: "B" },
      ],
      prismaSeats,
      dashboardUserIdByNormEmail: dash,
    });
    expect(merged).toHaveLength(3);
    expect(merged[0]?.email).toBe("a@x.com");
    expect(merged[0]?.subTier).toBe("LIGHT");
    expect(merged[1]?.userId).toBe("u-b");
    expect(merged[1]?.subTier).toBe("STANDARD");
    expect(merged[2]?.email).toBe("orphan@x.com");
  });

  it("uses openai-org id when no dashboard user for org-only email", () => {
    const merged = mergeOrgUsersWithPrismaCodexSeats({
      orgMembers: [{ id: "ou_x", email: "ghost@x.com", displayName: "Ghost" }],
      prismaSeats: [],
      dashboardUserIdByNormEmail: new Map(),
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.userId).toBe("openai-org:ou_x");
  });
});
