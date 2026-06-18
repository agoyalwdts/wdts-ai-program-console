import { describe, expect, it } from "vitest";
import { resolveAlertSubjectAccess } from "./alert-subject-access";

describe("resolveAlertSubjectAccess", () => {
  it("treats mirror-only rows as not invited", () => {
    const access = resolveAlertSubjectAccess({
      hasUserRow: true,
      dashboardRoleId: null,
      disabled: true,
      canManageUsers: true,
      hasEmail: true,
    });
    expect(access.notInvited).toBe(true);
    expect(access.consoleBlocked).toBe(false);
    expect(access.canBlockConsole).toBe(false);
    expect(access.canAllowConsole).toBe(false);
  });

  it("treats invited disabled users as console blocked", () => {
    const access = resolveAlertSubjectAccess({
      hasUserRow: true,
      dashboardRoleId: "role-1",
      disabled: true,
      canManageUsers: true,
      hasEmail: true,
    });
    expect(access.consoleBlocked).toBe(true);
    expect(access.canAllowConsole).toBe(true);
    expect(access.canBlockConsole).toBe(false);
  });
});
