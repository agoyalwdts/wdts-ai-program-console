import { describe, expect, it } from "vitest";
import {
  bootstrapRoleForNewUser,
  dbRole,
  isBootstrapAdmin,
} from "./auth-roles";

describe("isBootstrapAdmin", () => {
  it("returns true for the owner email", () => {
    expect(isBootstrapAdmin("agoyal@wdtablesystems.com")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isBootstrapAdmin("AGOYAL@WDTABLESYSTEMS.COM")).toBe(true);
    expect(isBootstrapAdmin("Agoyal@WdtableSystems.com")).toBe(true);
  });

  it("returns false for any other email", () => {
    expect(isBootstrapAdmin("anyone@wdtablesystems.com")).toBe(false);
    expect(isBootstrapAdmin("agoyal@elsewhere.com")).toBe(false);
    expect(isBootstrapAdmin("")).toBe(false);
    expect(isBootstrapAdmin("not-an-email")).toBe(false);
  });

  it("does not partial-match the owner regex", () => {
    // Defensive: the owner pattern is anchored. A sloppy regex would
    // promote agoyal@wdtablesystems.com.evil.example.
    expect(isBootstrapAdmin("agoyal@wdtablesystems.com.evil")).toBe(false);
    expect(isBootstrapAdmin("xagoyal@wdtablesystems.com")).toBe(false);
  });
});

describe("bootstrapRoleForNewUser", () => {
  it("returns ADMIN with email-bootstrap source for the owner email", () => {
    const r = bootstrapRoleForNewUser("agoyal@wdtablesystems.com");
    expect(r.role).toBe("ADMIN");
    expect(r.source.kind).toBe("email-bootstrap");
    if (r.source.kind === "email-bootstrap") {
      expect(r.source.pattern).toMatch(/agoyal/i);
    }
  });

  it("matches the bootstrap email case-insensitively", () => {
    const r = bootstrapRoleForNewUser("AGOYAL@WDTABLESYSTEMS.COM");
    expect(r.role).toBe("ADMIN");
    expect(r.source.kind).toBe("email-bootstrap");
  });

  it("returns USER with default source for any other email", () => {
    expect(bootstrapRoleForNewUser("anyone@wdts.com")).toEqual({
      role: "USER",
      source: { kind: "default" },
    });
    expect(bootstrapRoleForNewUser("finops@wdts.com")).toEqual({
      role: "USER",
      source: { kind: "default" },
    });
  });

  it("does NOT match a near-miss email pattern", () => {
    // Defensive: the email rule is anchored, not a `.startsWith(`. A
    // sloppy regex would accidentally promote agoyal@elsewhere.com.
    const r = bootstrapRoleForNewUser("agoyal@anothertenant.com");
    expect(r.role).toBe("USER");
    expect(r.source).toEqual({ kind: "default" });
  });
});

describe("dbRole", () => {
  it("preserves the role for built-in keys", () => {
    expect(dbRole("ADMIN")).toEqual({
      role: "ADMIN",
      source: { kind: "db", roleKey: "ADMIN" },
    });
    expect(dbRole("FINOPS").role).toBe("FINOPS");
    expect(dbRole("MANAGER").role).toBe("MANAGER");
    expect(dbRole("USER").role).toBe("USER");
  });

  it("falls back to USER for custom role keys (back-compat)", () => {
    // Custom roles can't be expressed in the legacy `DashboardRole`
    // union; `requireRole(...)` callers see USER. Permissions array
    // (set elsewhere on the session) is the real source of truth.
    const r = dbRole("auditor");
    expect(r.role).toBe("USER");
    expect(r.source).toEqual({ kind: "db", roleKey: "auditor" });
  });
});
