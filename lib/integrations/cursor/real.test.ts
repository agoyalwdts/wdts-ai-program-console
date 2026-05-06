import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRealCursorClient } from "./real";

const mockList = vi.fn();

vi.mock("./prisma-cursor-seats", () => ({
  listCursorSeatsFromPrisma: () => mockList(),
}));

describe("makeRealCursorClient.listSeats", () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it("returns Prisma-derived seats (same path as synthetic F4 board)", async () => {
    mockList.mockResolvedValue([
      {
        userId: "uuid-1",
        email: "alice@wdts.com",
        displayName: "Alice",
        subTier: "STANDARD",
        lastActivityTs: null,
        idleDays: null,
        mtdSpendUsd: 12.5,
      },
    ]);
    const seats = await makeRealCursorClient().listSeats();
    expect(seats).toHaveLength(1);
    expect(seats[0]?.email).toBe("alice@wdts.com");
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("does not require SCIM env vars", async () => {
    mockList.mockResolvedValue([]);
    await expect(makeRealCursorClient().listSeats()).resolves.toEqual([]);
  });
});

describe("makeRealCursorClient.listWaitlist", () => {
  it("returns [] (dashboard-local concept)", async () => {
    expect(await makeRealCursorClient().listWaitlist()).toEqual([]);
  });
});
