import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  PERMISSION_CATALOG,
  isValidPermissionKey,
} from "./permissions";
import {
  BUILT_IN_ROLES,
  BUILT_IN_ROLE_KEYS,
  getBuiltInRole,
  isBuiltInRoleKey,
} from "./built-in-roles";

describe("PERMISSIONS catalogue", () => {
  it("ALL_PERMISSION_KEYS is in 1:1 correspondence with PERMISSIONS", () => {
    const fromConst = Object.values(PERMISSIONS).sort();
    const fromArr = [...ALL_PERMISSION_KEYS].sort();
    expect(fromArr).toEqual(fromConst);
  });

  it("PERMISSION_CATALOG has an entry for every permission, keyed correctly", () => {
    const catKeys = PERMISSION_CATALOG.map((p) => p.key).sort();
    expect(catKeys).toEqual([...ALL_PERMISSION_KEYS].sort());
  });

  it("permission keys follow the resource.verb naming convention", () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key, `permission key ${key}`).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("permission keys are unique", () => {
    const seen = new Set<string>();
    for (const k of ALL_PERMISSION_KEYS) {
      expect(seen.has(k), `duplicate ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it("isValidPermissionKey accepts catalogue members and rejects others", () => {
    expect(isValidPermissionKey(PERMISSIONS.USERS_MANAGE)).toBe(true);
    expect(isValidPermissionKey("not.real")).toBe(false);
    expect(isValidPermissionKey("")).toBe(false);
  });
});

describe("BUILT_IN_ROLES", () => {
  it("has the four expected keys, in role-precedence order", () => {
    expect(BUILT_IN_ROLE_KEYS).toEqual(["USER", "MANAGER", "FINOPS", "ADMIN"]);
  });

  it("ADMIN grants every permission in the catalogue", () => {
    const admin = getBuiltInRole("ADMIN")!;
    expect(admin.permissions.length).toBe(ALL_PERMISSION_KEYS.length);
    for (const k of ALL_PERMISSION_KEYS) {
      expect(admin.permissions).toContain(k);
    }
  });

  it("FINOPS ⊃ MANAGER ⊃ USER (each tier extends the one below)", () => {
    const user = getBuiltInRole("USER")!.permissions;
    const manager = getBuiltInRole("MANAGER")!.permissions;
    const finops = getBuiltInRole("FINOPS")!.permissions;

    for (const p of user) expect(manager).toContain(p);
    for (const p of manager) expect(finops).toContain(p);
  });

  it("USER does NOT have admin permissions", () => {
    const user = getBuiltInRole("USER")!;
    expect(user.permissions).not.toContain(PERMISSIONS.USERS_MANAGE);
    expect(user.permissions).not.toContain(PERMISSIONS.ROLES_MANAGE);
    expect(user.permissions).not.toContain(PERMISSIONS.IMPORTS_EMPLOYEES);
    expect(user.permissions).not.toContain(PERMISSIONS.IMPORTS_CURSOR_USAGE);
  });

  it("MANAGER does NOT have FinOps surfaces", () => {
    const m = getBuiltInRole("MANAGER")!;
    expect(m.permissions).not.toContain(PERMISSIONS.DASHBOARD_VIEW_CHARGEBACK);
    expect(m.permissions).not.toContain(PERMISSIONS.IMPORTS_EMPLOYEES);
    expect(m.permissions).not.toContain(PERMISSIONS.IMPORTS_CURSOR_USAGE);
    expect(m.permissions).not.toContain(PERMISSIONS.USERS_MANAGE);
  });

  it("FINOPS has chargeback + imports, not user/role management", () => {
    const f = getBuiltInRole("FINOPS")!;
    expect(f.permissions).toContain(PERMISSIONS.DASHBOARD_VIEW_CHARGEBACK);
    expect(f.permissions).toContain(PERMISSIONS.IMPORTS_EMPLOYEES);
    expect(f.permissions).toContain(PERMISSIONS.IMPORTS_CURSOR_USAGE);
    expect(f.permissions).not.toContain(PERMISSIONS.USERS_MANAGE);
    expect(f.permissions).not.toContain(PERMISSIONS.ROLES_MANAGE);
  });

  it("isBuiltInRoleKey accepts only the four built-ins", () => {
    expect(isBuiltInRoleKey("ADMIN")).toBe(true);
    expect(isBuiltInRoleKey("FINOPS")).toBe(true);
    expect(isBuiltInRoleKey("USER")).toBe(true);
    expect(isBuiltInRoleKey("MANAGER")).toBe(true);
    expect(isBuiltInRoleKey("auditor")).toBe(false);
    expect(isBuiltInRoleKey("admin")).toBe(false); // case-sensitive
    expect(isBuiltInRoleKey("")).toBe(false);
  });

  it("every permission a built-in grants is a known catalogue key", () => {
    for (const role of BUILT_IN_ROLES) {
      for (const p of role.permissions) {
        expect(
          isValidPermissionKey(p),
          `role ${role.key} grants unknown permission ${p}`,
        ).toBe(true);
      }
    }
  });

  it("getBuiltInRole returns undefined for unknown keys", () => {
    expect(getBuiltInRole("nope")).toBeUndefined();
    expect(getBuiltInRole("")).toBeUndefined();
  });
});
