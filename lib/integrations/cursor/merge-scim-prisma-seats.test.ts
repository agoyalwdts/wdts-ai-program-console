import { describe, expect, it } from "vitest";
import { mergeScimMembersWithPrismaSeats } from "./merge-scim-prisma-seats";
import type { CursorSeat } from "./types";

describe("mergeScimMembersWithPrismaSeats", () => {
  const prismaSeat: CursorSeat = {
    userId: "uuid-a",
    email: "alice@w.com",
    displayName: "Alice Lic",
    subTier: "POWER",
    lastActivityTs: null,
    idleDays: 2,
    mtdSpendUsd: 5,
  };

  it("uses Prisma row when SCIM email matches (case-insensitive)", () => {
    const merged = mergeScimMembersWithPrismaSeats(
      [{ id: "s1", email: "Alice@w.com", displayName: "Alice SCIM", active: true }],
      [prismaSeat],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(prismaSeat);
  });

  it("adds SCIM-only members as STANDARD placeholders", () => {
    const merged = mergeScimMembersWithPrismaSeats(
      [
        { id: "s1", email: "bob@w.com", displayName: "Bob", active: true },
        { id: "s2", email: "alice@w.com", displayName: "A", active: true },
      ],
      [prismaSeat],
    );
    expect(merged).toHaveLength(2);
    const bob = merged.find((x) => x.email === "bob@w.com");
    expect(bob?.userId).toBe("scim:s1");
    expect(bob?.subTier).toBe("STANDARD");
    expect(bob?.mtdSpendUsd).toBe(0);
    expect(merged.find((x) => x.email === "alice@w.com")?.userId).toBe("uuid-a");
  });

  it("appends Prisma seats missing from SCIM", () => {
    const extra: CursorSeat = {
      ...prismaSeat,
      userId: "uuid-b",
      email: "carol@w.com",
      displayName: "Carol",
      subTier: "LIGHT",
    };
    const merged = mergeScimMembersWithPrismaSeats(
      [{ id: "s1", email: "alice@w.com", displayName: "A", active: true }],
      [prismaSeat, extra],
    );
    expect(merged.map((x) => x.email).sort()).toEqual(["alice@w.com", "carol@w.com"]);
  });
});
