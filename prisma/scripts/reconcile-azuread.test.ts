/**
 * Unit tests for the Azure AD reconciler. Both Prisma and the
 * realAzureADClient are mocked; this is a pure-logic test of the
 * decision tree (create / update / suspend / skip) and of the
 * dry-run vs apply paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityUser } from "@/lib/integrations/azuread/types";

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn<() => Promise<IdentityUser[]>>(),
  findMany: vi.fn(),
  txCreateUser: vi.fn(),
  txUpdateUser: vi.fn(),
  txFindMany: vi.fn(),
  txCreateDecision: vi.fn(),
  $transaction: vi.fn<(cb: (tx: unknown) => Promise<void>) => Promise<void>>(),
}));

vi.mock("@/lib/integrations/azuread/real", () => ({
  realAzureADClient: { listUsers: mocks.listUsers },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.findMany },
    $transaction: mocks.$transaction,
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.$transaction.mockImplementation(async (cb) => {
    await cb({
      user: {
        create: mocks.txCreateUser,
        update: mocks.txUpdateUser,
        findMany: mocks.txFindMany,
      },
      decision: { create: mocks.txCreateDecision },
    });
  });
  mocks.txCreateUser.mockResolvedValue({});
  mocks.txUpdateUser.mockResolvedValue({});
  mocks.txFindMany.mockResolvedValue([]);
  mocks.txCreateDecision.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function gu(over: Partial<IdentityUser> = {}): IdentityUser {
  return {
    email: "x@w.com",
    displayName: "X",
    azureObjectId: "id-x",
    managerEmail: null,
    status: "ACTIVE",
    ...over,
  };
}

async function run(dryRun = false) {
  const { reconcileAzureAD } = await import("./reconcile-azuread");
  return reconcileAzureAD({ dryRun });
}

describe("reconcileAzureAD", () => {
  it("creates Prisma users for Graph users not in Prisma", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "alice@w.com", displayName: "Alice" }),
    ]);
    mocks.findMany.mockResolvedValueOnce([]);

    const summary = await run(false);

    expect(summary.prismaCreated).toBe(1);
    expect(mocks.txFindMany).toHaveBeenCalled();
    expect(summary.prismaUpdated).toBe(0);
    expect(summary.prismaSuspended).toBe(0);
    expect(mocks.txCreateUser).toHaveBeenCalledWith({
      data: {
        email: "alice@w.com",
        displayName: "Alice",
        roleTag: "imported",
        region: "unknown",
        status: "ACTIVE",
        disabled: true,
      },
    });
  });

  it("updates only when displayName or status changed", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "alice@w.com", displayName: "Alice (renamed)" }),
      gu({ email: "bob@w.com", displayName: "Bob" }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      { id: "u-a", email: "alice@w.com", displayName: "Alice", status: "ACTIVE" },
      { id: "u-b", email: "bob@w.com", displayName: "Bob", status: "ACTIVE" },
    ]);

    const summary = await run(false);

    expect(summary.prismaUpdated).toBe(1);
    expect(summary.prismaSkippedClean).toBe(1);
    expect(mocks.txUpdateUser).toHaveBeenCalledTimes(1);
    expect(mocks.txUpdateUser).toHaveBeenCalledWith({
      where: { email: "alice@w.com" },
      data: { displayName: "Alice (renamed)", status: "ACTIVE" },
    });
  });

  it("suspends Prisma users that no longer appear in Graph", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "alice@w.com", displayName: "Alice" }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      { id: "u-a", email: "alice@w.com", displayName: "Alice", status: "ACTIVE" },
      { id: "u-b", email: "leftcompany@w.com", displayName: "Bob", status: "ACTIVE" },
    ]);

    const summary = await run(false);

    expect(summary.prismaSuspended).toBe(1);
    expect(mocks.txUpdateUser).toHaveBeenCalledWith({
      where: { email: "leftcompany@w.com" },
      data: { status: "SUSPENDED" },
    });
  });

  it("does not re-suspend already-SUSPENDED users", async () => {
    mocks.listUsers.mockResolvedValueOnce([]);
    mocks.findMany.mockResolvedValueOnce([
      { id: "u-x", email: "x@w.com", displayName: "X", status: "SUSPENDED" },
    ]);
    const summary = await run(false);
    expect(summary.prismaSuspended).toBe(0);
    expect(mocks.txUpdateUser).not.toHaveBeenCalled();
  });

  it("skips Graph users with no email and counts them", async () => {
    mocks.listUsers.mockResolvedValueOnce([gu({ email: "" }), gu({ email: "ok@w.com" })]);
    mocks.findMany.mockResolvedValueOnce([]);
    const summary = await run(false);
    expect(summary.graphSkippedNoEmail).toBe(1);
    expect(summary.prismaCreated).toBe(1);
  });

  it("dry-run never calls into Prisma write paths", async () => {
    mocks.listUsers.mockResolvedValueOnce([gu({ email: "a@w.com" })]);
    mocks.findMany.mockResolvedValueOnce([]);

    const summary = await run(true);

    expect(summary.prismaCreated).toBe(1);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.txCreateUser).not.toHaveBeenCalled();
    expect(mocks.txCreateDecision).not.toHaveBeenCalled();
  });

  it("apply mode wraps everything in one Decision row", async () => {
    mocks.listUsers.mockResolvedValueOnce([gu({ email: "a@w.com" })]);
    mocks.findMany.mockResolvedValueOnce([]);

    await run(false);

    expect(mocks.txCreateDecision).toHaveBeenCalledTimes(1);
    const call = mocks.txCreateDecision.mock.calls[0][0];
    expect(call.data.type).toBe("METHODOLOGY_CHANGE");
    expect(call.data.actorEmail).toBe("azuread-reconciler@dashboard");
    expect(call.data.justification).toContain("1 created");
  });

  it("ACTIVE↔SUSPENDED status changes propagate", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "x@w.com", displayName: "X", status: "SUSPENDED" }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      { id: "u-x", email: "x@w.com", displayName: "X", status: "ACTIVE" },
    ]);
    await run(false);
    expect(mocks.txUpdateUser).toHaveBeenCalledWith({
      where: { email: "x@w.com" },
      data: { displayName: "X", status: "SUSPENDED" },
    });
  });
});

describe("reconcileAzureAD — manager-edge reconciliation", () => {
  it("links a managerId when Graph reports a manager whose email IS in Prisma", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "rep@w.com", managerEmail: "boss@w.com" }),
      gu({ email: "boss@w.com", managerEmail: null }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "u-rep",
        email: "rep@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
      {
        id: "u-boss",
        email: "boss@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
    ]);
    mocks.txFindMany.mockResolvedValueOnce([
      { id: "u-rep", email: "rep@w.com" },
      { id: "u-boss", email: "boss@w.com" },
    ]);

    const summary = await run(false);
    expect(summary.managerEdgesLinked).toBe(1);
    expect(summary.managerEdgesCleared).toBe(0);
    expect(summary.managerEdgesUnresolved).toBe(0);
    expect(mocks.txUpdateUser).toHaveBeenCalledWith({
      where: { email: "rep@w.com" },
      data: { managerId: "u-boss" },
    });
  });

  it("clears managerId when Graph reports null but Prisma has one", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "rep@w.com", managerEmail: null }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "u-rep",
        email: "rep@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: "u-old-boss",
      },
    ]);

    mocks.txFindMany.mockResolvedValueOnce([{ id: "u-rep", email: "rep@w.com" }]);

    const summary = await run(false);
    expect(summary.managerEdgesCleared).toBe(1);
    expect(summary.managerEdgesLinked).toBe(0);
    expect(mocks.txUpdateUser).toHaveBeenCalledWith({
      where: { email: "rep@w.com" },
      data: { managerId: null },
    });
  });

  it("counts unresolved-manager edges without writing", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "rep@w.com", managerEmail: "boss-not-in-prisma@w.com" }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "u-rep",
        email: "rep@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
    ]);

    mocks.txFindMany.mockResolvedValueOnce([{ id: "u-rep", email: "rep@w.com" }]);

    const summary = await run(false);
    expect(summary.managerEdgesUnresolved).toBe(1);
    expect(summary.managerEdgesLinked).toBe(0);
    expect(summary.managerEdgesCleared).toBe(0);
    // No manager-related update should fire.
    const managerTouches = mocks.txUpdateUser.mock.calls.filter(
      (c: unknown[]) => {
        const arg = c[0] as { data?: { managerId?: unknown } };
        return arg?.data && Object.prototype.hasOwnProperty.call(arg.data, "managerId");
      },
    );
    expect(managerTouches).toHaveLength(0);
  });

  it("doesn't re-write a managerId edge that already matches Graph", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "rep@w.com", managerEmail: "boss@w.com" }),
      gu({ email: "boss@w.com", managerEmail: null }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "u-rep",
        email: "rep@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: "u-boss",
      },
      {
        id: "u-boss",
        email: "boss@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
    ]);

    mocks.txFindMany.mockResolvedValueOnce([
      { id: "u-rep", email: "rep@w.com" },
      { id: "u-boss", email: "boss@w.com" },
    ]);

    const summary = await run(false);
    expect(summary.managerEdgesLinked).toBe(0);
    expect(summary.managerEdgesCleared).toBe(0);
  });

  it("links manager edges for users created in the same reconciliation pass", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "rep@w.com", managerEmail: "boss@w.com" }),
      gu({ email: "boss@w.com", managerEmail: null }),
    ]);
    mocks.findMany.mockResolvedValueOnce([]);
    mocks.txFindMany.mockResolvedValueOnce([
      { id: "u-rep", email: "rep@w.com" },
      { id: "u-boss", email: "boss@w.com" },
    ]);

    const summary = await run(false);
    expect(summary.prismaCreated).toBe(2);
    expect(summary.managerEdgesLinked).toBe(1);
    expect(mocks.txUpdateUser).toHaveBeenCalledWith({
      where: { email: "rep@w.com" },
      data: { managerId: "u-boss" },
    });
  });

  it("dry-run reports manager counts but doesn't write", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "rep@w.com", managerEmail: "boss@w.com" }),
      gu({ email: "boss@w.com", managerEmail: null }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "u-rep",
        email: "rep@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
      {
        id: "u-boss",
        email: "boss@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
    ]);

    const summary = await run(true);
    expect(summary.managerEdgesLinked).toBe(1);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("re-points a managerId when the manager actually changed", async () => {
    mocks.listUsers.mockResolvedValueOnce([
      gu({ email: "rep@w.com", managerEmail: "newboss@w.com" }),
      gu({ email: "newboss@w.com", managerEmail: null }),
      gu({ email: "oldboss@w.com", managerEmail: null }),
    ]);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "u-rep",
        email: "rep@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: "u-oldboss",
      },
      {
        id: "u-oldboss",
        email: "oldboss@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
      {
        id: "u-newboss",
        email: "newboss@w.com",
        displayName: "X",
        status: "ACTIVE",
        managerId: null,
      },
    ]);
    mocks.txFindMany.mockResolvedValueOnce([
      { id: "u-rep", email: "rep@w.com" },
      { id: "u-oldboss", email: "oldboss@w.com" },
      { id: "u-newboss", email: "newboss@w.com" },
    ]);

    await run(false);
    expect(mocks.txUpdateUser).toHaveBeenCalledWith({
      where: { email: "rep@w.com" },
      data: { managerId: "u-newboss" },
    });
  });
});
