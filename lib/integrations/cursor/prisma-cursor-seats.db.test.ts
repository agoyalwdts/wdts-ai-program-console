import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listCursorSeatsFromPrisma } from "./prisma-cursor-seats";

describe("listCursorSeatsFromPrisma", () => {
  it("returns one seat per CURSOR license in the DB", async () => {
    const licCount = await prisma.license.count({ where: { product: "CURSOR" } });
    const seats = await listCursorSeatsFromPrisma();
    expect(seats).toHaveLength(licCount);
    for (const s of seats) {
      expect(s.email).toMatch(/@/);
      expect(["POWER", "STANDARD", "LIGHT", "DISCOVERY"]).toContain(s.subTier);
    }
  });
});
