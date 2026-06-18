import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PolicyRepoClient } from "@/lib/integrations/policyrepo/types";

const policyRepo: PolicyRepoClient = {
  openPullRequest: vi.fn(async () => ({
    number: 42,
    url: "https://example.test/pr/42",
    branch: "dashboard/dec-1",
    state: "OPEN" as const,
  })),
  getPullRequest: vi.fn(),
};

describe("requestCodexTierMove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects short justification", async () => {
    const { requestCodexTierMove } = await import("./codex-tier-move");
    const result = await requestCodexTierMove({
      prisma: {} as never,
      actorEmail: "admin@test.local",
      userId: "u1",
      direction: "promote",
      justification: "short",
      policyRepo,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("creates decision and opens policy PR on success", async () => {
    const prisma = {
      license: {
        findUnique: vi.fn(async () => ({
          subTier: "codex_discovery",
          capUsdMonth: 75,
          user: { email: "alice@wdts.com", displayName: "Alice" },
        })),
      },
      decision: {
        create: vi.fn(async () => ({ id: "dec-abc" })),
        update: vi.fn(async () => ({})),
      },
    };

    const { requestCodexTierMove } = await import("./codex-tier-move");
    const result = await requestCodexTierMove({
      prisma: prisma as never,
      actorEmail: "admin@test.local",
      userId: "u1",
      direction: "promote",
      justification: "Promotion candidate per F9 ladder queue.",
      policyRepo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisionType).toBe("TIER_PROMOTION");
      expect(result.toSubTier).toBe("LIGHT");
      expect(result.prNumber).toBe(42);
    }
    expect(policyRepo.openPullRequest).toHaveBeenCalledOnce();
    expect(prisma.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { evidenceLink: "https://example.test/pr/42" },
      }),
    );
  });
});
