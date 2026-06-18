import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeRealCursorClient } from "./real";

const mockLoad = vi.fn();

vi.mock("./workspace-seats", () => ({
  loadCursorWorkspaceSeats: (...args: unknown[]) => mockLoad(...args),
}));

describe("makeRealCursorClient", () => {
  beforeEach(() => {
    mockLoad.mockReset();
  });

  it("listSeats delegates to loadCursorWorkspaceSeats", async () => {
    mockLoad.mockResolvedValue({
      seats: [{ userId: "cursor:admin-1", email: "a@w.com", displayName: "A", subTier: "STANDARD", lastActivityTs: null, idleDays: null, mtdSpendUsd: 0 }],
      source: "team_admin",
      warnings: [],
      waitlist: [],
    });
    const seats = await makeRealCursorClient().listSeats();
    expect(seats).toHaveLength(1);
    expect(mockLoad).toHaveBeenCalled();
  });

  it("listWaitlist returns []", async () => {
    expect(await makeRealCursorClient().listWaitlist()).toEqual([]);
  });
});
