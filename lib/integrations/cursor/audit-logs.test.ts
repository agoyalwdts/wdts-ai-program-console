import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
}));

vi.mock("./cursor-team-http", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./cursor-team-http")>();
  return {
    ...mod,
    cursorTeamGetJson: mocks.getJson,
  };
});

vi.mock("../env", () => ({
  getIntegrationMode: vi.fn(() => "real"),
}));

vi.mock("./team-admin-usage", () => ({
  resolveCursorTeamAdminApiKey: vi.fn(() => "test-key"),
}));

afterEach(async () => {
  mocks.getJson.mockReset();
  const { clearCursorTeamEtagCacheForTests } = await import("./cursor-team-http");
  clearCursorTeamEtagCacheForTests();
});

describe("summarizeCursorLoginIpsForEmail", () => {
  it("returns distinct login IPs for the user", async () => {
    mocks.getJson.mockResolvedValue({
      events: [
        {
          event_type: "login",
          user_email: "dev@wdtablesystems.com",
          ip_address: "203.0.113.1",
        },
        {
          event_type: "login",
          user_email: "dev@wdtablesystems.com",
          ip_address: "203.0.113.1",
        },
        {
          event_type: "login",
          user_email: "dev@wdtablesystems.com",
          ip_address: "198.51.100.9",
        },
      ],
      pagination: { hasNextPage: false },
    });

    const { summarizeCursorLoginIpsForEmail } = await import("./audit-logs");
    const summary = await summarizeCursorLoginIpsForEmail({
      email: "dev@wdtablesystems.com",
      env: { INTEGRATION_CURSOR: "real", CURSOR_ADMIN_TOKEN: "x" },
    });

    expect(summary.available).toBe(true);
    if (summary.available) {
      expect(summary.distinctIps).toEqual(["198.51.100.9", "203.0.113.1"]);
      expect(summary.loginEventCount).toBe(3);
    }
  });
});
