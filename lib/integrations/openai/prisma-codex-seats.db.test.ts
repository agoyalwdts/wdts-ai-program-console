import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listCodexSeatsFromPrisma } from "./prisma-codex-seats";

describe("listCodexSeatsFromPrisma", () => {
  it("returns one seat per CODEX license", async () => {
    const n = await prisma.license.count({ where: { product: "CODEX" } });
    const seats = await listCodexSeatsFromPrisma();
    expect(seats).toHaveLength(n);
  });
});
