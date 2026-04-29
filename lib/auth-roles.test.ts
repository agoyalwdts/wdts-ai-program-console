import { describe, expect, it } from "vitest";
import {
  loadGroupRoleMap,
  roleFromClaims,
  roleFromClaimsWithTrace,
} from "./auth-roles";

describe("roleFromClaims", () => {
  describe("email fallback (no group map)", () => {
    it("groups claim with no matching env-mapped id falls through to email", () => {
      const role = roleFromClaims({
        email: "anuj.goyal@example.com",
        groups: ["fake-id-not-in-map"],
        groupRoleMap: {},
      });
      expect(role).toBe("ADMIN");
    });

    it("matches ADMIN by email", () => {
      expect(roleFromClaims({ email: "anuj.goyal@example.com", groupRoleMap: {} })).toBe("ADMIN");
      expect(roleFromClaims({ email: "anuj@wdts.com", groupRoleMap: {} })).toBe("ADMIN");
    });

    it("matches FINOPS by email", () => {
      expect(roleFromClaims({ email: "finops@wdts.com", groupRoleMap: {} })).toBe("FINOPS");
    });

    it("matches MANAGER by email", () => {
      expect(roleFromClaims({ email: "managers@wdts.com", groupRoleMap: {} })).toBe("MANAGER");
    });

    it("falls back to USER for unmatched emails", () => {
      expect(roleFromClaims({ email: "alice@wdts.com", groupRoleMap: {} })).toBe("USER");
      expect(roleFromClaims({ email: "", groupRoleMap: {} })).toBe("USER");
    });

    it("is case-insensitive on email rules", () => {
      expect(roleFromClaims({ email: "ANUJ.GOYAL@EXAMPLE.COM", groupRoleMap: {} })).toBe("ADMIN");
    });
  });

  describe("group-claim resolution", () => {
    const map = {
      "00000000-0000-0000-0000-aaaaaaaaaaaa": "ADMIN",
      "00000000-0000-0000-0000-bbbbbbbbbbbb": "FINOPS",
      "00000000-0000-0000-0000-cccccccccccc": "MANAGER",
    } as const;

    it("group hit beats email rules", () => {
      // anuj.* would otherwise match ADMIN by email. Here a FINOPS group
      // wins because step 1 (group claim) takes precedence over step 2.
      const role = roleFromClaims({
        email: "anuj.goyal@example.com",
        groups: ["00000000-0000-0000-0000-bbbbbbbbbbbb"],
        groupRoleMap: map,
      });
      expect(role).toBe("FINOPS");
    });

    it("first-matching-group wins (claim order matters)", () => {
      const role = roleFromClaims({
        email: "alice@wdts.com",
        groups: [
          "00000000-0000-0000-0000-bbbbbbbbbbbb",
          "00000000-0000-0000-0000-aaaaaaaaaaaa",
        ],
        groupRoleMap: map,
      });
      expect(role).toBe("FINOPS");
    });

    it("group claim with no entries falls through to email", () => {
      expect(
        roleFromClaims({ email: "finops@wdts.com", groups: [], groupRoleMap: map }),
      ).toBe("FINOPS");
    });
  });
});

describe("loadGroupRoleMap", () => {
  it("returns empty when no env vars set", () => {
    expect(loadGroupRoleMap({})).toEqual({});
  });

  it("parses a single role's comma-separated id list", () => {
    const map = loadGroupRoleMap({
      AZURE_AD_GROUP_ADMIN_IDS: "id-1, id-2 ,id-3",
    });
    expect(map).toEqual({ "id-1": "ADMIN", "id-2": "ADMIN", "id-3": "ADMIN" });
  });

  it("merges multiple role env vars", () => {
    const map = loadGroupRoleMap({
      AZURE_AD_GROUP_ADMIN_IDS: "admin-id",
      AZURE_AD_GROUP_FINOPS_IDS: "finops-id-1,finops-id-2",
      AZURE_AD_GROUP_MANAGER_IDS: "mgr-id",
    });
    expect(map).toEqual({
      "admin-id": "ADMIN",
      "finops-id-1": "FINOPS",
      "finops-id-2": "FINOPS",
      "mgr-id": "MANAGER",
    });
  });

  it("ignores blank entries from sloppy env strings", () => {
    expect(
      loadGroupRoleMap({ AZURE_AD_GROUP_ADMIN_IDS: ",,id-1,  ,id-2,," }),
    ).toEqual({ "id-1": "ADMIN", "id-2": "ADMIN" });
  });

  it("higher-precedence role wins on duplicate id (ADMIN > FINOPS > MANAGER)", () => {
    // Same id listed in two roles: the role processed first (ADMIN per
    // ENV_GROUP_VARS order) keeps it. Caller intent is preserved.
    const map = loadGroupRoleMap({
      AZURE_AD_GROUP_ADMIN_IDS: "shared-id",
      AZURE_AD_GROUP_FINOPS_IDS: "shared-id",
    });
    expect(map["shared-id"]).toBe("ADMIN");
  });

  it("does not read process.env when an explicit env arg is passed", () => {
    // Sanity-check for the dependency injection: prevents this test
    // suite from being polluted by whatever happens to be in
    // process.env on the developer's machine.
    const before = process.env.AZURE_AD_GROUP_ADMIN_IDS;
    process.env.AZURE_AD_GROUP_ADMIN_IDS = "leaked";
    try {
      expect(loadGroupRoleMap({})).toEqual({});
    } finally {
      if (before === undefined) delete process.env.AZURE_AD_GROUP_ADMIN_IDS;
      else process.env.AZURE_AD_GROUP_ADMIN_IDS = before;
    }
  });
});

describe("roleFromClaimsWithTrace", () => {
  const map = {
    "00000000-0000-0000-0000-aaaaaaaaaaaa": "ADMIN" as const,
    "00000000-0000-0000-0000-bbbbbbbbbbbb": "FINOPS" as const,
  };

  it("group hit reports the matching group OID", () => {
    const trace = roleFromClaimsWithTrace({
      email: "alice@wdts.com",
      groups: [
        "no-match",
        "00000000-0000-0000-0000-aaaaaaaaaaaa",
        "00000000-0000-0000-0000-bbbbbbbbbbbb",
      ],
      groupRoleMap: map,
    });
    expect(trace).toEqual({
      role: "ADMIN",
      source: {
        kind: "group",
        groupId: "00000000-0000-0000-0000-aaaaaaaaaaaa",
      },
    });
  });

  it("email-rule hit reports the pattern that matched", () => {
    const trace = roleFromClaimsWithTrace({
      email: "anuj.goyal@example.com",
      groupRoleMap: {},
    });
    expect(trace.role).toBe("ADMIN");
    expect(trace.source).toMatchObject({ kind: "email" });
    if (trace.source.kind === "email") {
      // The pattern matches the rule actually defined in EMAIL_ROLE_RULES.
      expect(trace.source.pattern).toMatch(/anuj/i);
    }
  });

  it("group hit beats email rule even when both would match", () => {
    const trace = roleFromClaimsWithTrace({
      email: "anuj.goyal@example.com",
      groups: ["00000000-0000-0000-0000-bbbbbbbbbbbb"],
      groupRoleMap: map,
    });
    expect(trace.role).toBe("FINOPS");
    expect(trace.source.kind).toBe("group");
  });

  it("falls through to default with kind='default'", () => {
    const trace = roleFromClaimsWithTrace({
      email: "stranger@nowhere.test",
      groupRoleMap: {},
    });
    expect(trace).toEqual({ role: "USER", source: { kind: "default" } });
  });

  it("roleFromClaims returns the same role as the trace function", () => {
    const args = {
      email: "anuj.goyal@example.com",
      groups: ["00000000-0000-0000-0000-bbbbbbbbbbbb"],
      groupRoleMap: map,
    };
    expect(roleFromClaims(args)).toBe(roleFromClaimsWithTrace(args).role);
  });
});
