import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PolicyRepoClient } from "@/lib/integrations/policyrepo/types";

const policyRepo: PolicyRepoClient = {
  openPullRequest: vi.fn(async () => ({
    number: 7,
    url: "https://example.test/pr/7",
    branch: "dashboard/dec-1",
    state: "OPEN" as const,
  })),
  getPullRequest: vi.fn(),
};

describe("reclamation-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createReclamationEvent opens NOTIFIED with dispute window", async () => {
    const prisma = {
      license: {
        findUnique: vi.fn(async () => ({
          id: "lic-1",
          subTier: "cursor_standard",
          user: { email: "idle@wdts.com", displayName: "Idle" },
        })),
      },
      reclamationEvent: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async (args: { data: { disputeWindowEndsAt: Date } }) => ({
          id: "rec-1",
          state: "NOTIFIED",
          subjectUserId: "u1",
          disputeWindowEndsAt: args.data.disputeWindowEndsAt,
          decisionId: null,
          subject: { email: "idle@wdts.com", displayName: "Idle" },
          license: { product: "CURSOR" },
        })),
      },
    };

    const { createReclamationEvent } = await import("./reclamation-events");
    const result = await createReclamationEvent({
      prisma: prisma as never,
      actorEmail: "admin@test.local",
      userId: "u1",
      product: "CURSOR",
      trigger: "IDLE",
      justification: "45 days idle on Cursor seat per policy.",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.state).toBe("NOTIFIED");
    }
    const createCall = prisma.reclamationEvent.create.mock.calls[0]?.[0] as {
      data: { disputeWindowEndsAt: Date | null };
    };
    expect(createCall.data.disputeWindowEndsAt).toBeInstanceOf(Date);
  });

  it("processExpiredReclamationDisputeWindows finalizes due events", async () => {
    const past = new Date("2020-01-01T00:00:00.000Z");
    const prisma = {
      reclamationEvent: {
        findMany: vi.fn(async () => [{ id: "rec-due", state: "NOTIFIED" }]),
        findUnique: vi.fn(async () => ({
          id: "rec-due",
          state: "NOTIFIED",
          subjectUserId: "u1",
          decisionId: null,
          justification: "idle",
          subject: { email: "a@wdts.com", displayName: "A" },
          license: { product: "CURSOR", subTier: "cursor_discovery" },
        })),
        update: vi.fn(async (args: { data: { state: string } }) => ({
          id: "rec-due",
          state: args.data.state,
          subjectUserId: "u1",
          disputeWindowEndsAt: past,
          decisionId: "dec-1",
          subject: { email: "a@wdts.com", displayName: "A" },
          license: { product: "CURSOR" },
        })),
      },
      decision: {
        create: vi.fn(async () => ({ id: "dec-1" })),
        update: vi.fn(async () => ({})),
      },
    };

    const { processExpiredReclamationDisputeWindows } = await import("./reclamation-events");
    const summary = await processExpiredReclamationDisputeWindows({
      prisma: prisma as never,
      now: new Date(),
      policyRepo,
    });

    expect(summary.expired).toBe(1);
    expect(policyRepo.openPullRequest).toHaveBeenCalledOnce();
  });
});
