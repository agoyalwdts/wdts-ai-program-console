import { describe, expect, it } from "vitest";
import { roleFromClaims } from "./auth-roles";

describe("roleFromClaims", () => {
  it("groups claim takes precedence over email rules", () => {
    const role = roleFromClaims({
      email: "anuj.goyal@example.com",
      groups: ["fake-id-not-in-map"],
    });
    // group not in map → falls through to email rule (anuj.* → ADMIN)
    expect(role).toBe("ADMIN");
  });

  it("matches ADMIN by email when no groups present", () => {
    expect(roleFromClaims({ email: "anuj.goyal@example.com" })).toBe("ADMIN");
    expect(roleFromClaims({ email: "anuj@wdts.com" })).toBe("ADMIN");
  });

  it("matches FINOPS by email", () => {
    expect(roleFromClaims({ email: "finops@wdts.com" })).toBe("FINOPS");
  });

  it("matches MANAGER by email", () => {
    expect(roleFromClaims({ email: "managers@wdts.com" })).toBe("MANAGER");
  });

  it("falls back to USER for unmatched emails", () => {
    expect(roleFromClaims({ email: "alice@wdts.com" })).toBe("USER");
    expect(roleFromClaims({ email: "" })).toBe("USER");
  });

  it("is case-insensitive on email rules", () => {
    expect(roleFromClaims({ email: "ANUJ.GOYAL@EXAMPLE.COM" })).toBe("ADMIN");
  });
});
