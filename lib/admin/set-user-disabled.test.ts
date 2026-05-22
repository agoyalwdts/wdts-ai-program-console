import { describe, expect, it, vi, beforeEach } from "vitest";
import { setUserDisabled } from "./set-user-disabled";

const findUnique = vi.fn();
const transaction = vi.fn();

const prisma = {
  user: { findUnique },
  $transaction: transaction,
} as never;

beforeEach(() => {
  findUnique.mockReset();
  transaction.mockReset();
});

describe("setUserDisabled", () => {
  it("409s when disabling owner", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      email: "owner@test.local",
      disabled: false,
      isOwner: true,
    });
    const result = await setUserDisabled({
      prisma,
      actorEmail: "admin@test.local",
      userId: "u1",
      disabled: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("noOps when already disabled", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      email: "dev@test.local",
      disabled: true,
      isOwner: false,
    });
    const result = await setUserDisabled({
      prisma,
      actorEmail: "admin@test.local",
      userId: "u1",
      disabled: true,
    });
    expect(result).toMatchObject({ ok: true, noOp: true, disabled: true });
    expect(transaction).not.toHaveBeenCalled();
  });
});
