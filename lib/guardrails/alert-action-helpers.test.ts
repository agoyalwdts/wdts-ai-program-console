import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  requestSeatRemovalFromAlert,
  type GuardrailAlertForAction,
} from "./alert-action-helpers";

import type { PrismaClient } from "@prisma/client";

const findUnique = vi.fn();
const createDecision = vi.fn();

const prisma = {
  user: { findUnique },
  decision: { create: createDecision },
} as unknown as PrismaClient;

function sampleAlert(overrides: Partial<GuardrailAlertForAction> = {}): GuardrailAlertForAction {
  return {
    id: "alert-1",
    occurredAt: new Date("2026-05-20T12:00:00Z"),
    category: "CLOUD_CONTROL",
    severity: "MEDIUM",
    product: "CURSOR",
    userEmail: "dev@wdtablesystems.com",
    model: "gpt-5",
    ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
    title: "Region outside allowlist",
    rationale: "us-east-2",
    recommendation: null,
    acknowledgedAt: null,
    userEmailNotifiedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  createDecision.mockReset();
  createDecision.mockResolvedValue({ id: "dec-1" });
});

describe("requestSeatRemovalFromAlert", () => {
  it("400s without user email", async () => {
    const result = await requestSeatRemovalFromAlert({
      prisma,
      actorEmail: "admin@test.local",
      alert: sampleAlert({ userEmail: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("creates CURSOR_SEAT_RECLAIM for Cursor product", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      email: "dev@wdtablesystems.com",
      disabled: false,
      isOwner: false,
    });

    const result = await requestSeatRemovalFromAlert({
      prisma,
      actorEmail: "finops@test.local",
      alert: sampleAlert({ product: "CURSOR" }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisionType).toBe("CURSOR_SEAT_RECLAIM");
      expect(result.decisionId).toBe("dec-1");
    }
    expect(createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "CURSOR_SEAT_RECLAIM",
          subjectUserId: "u1",
          actorEmail: "finops@test.local",
        }),
      }),
    );
  });

  it("creates RECLAMATION for non-Cursor product", async () => {
    findUnique.mockResolvedValue(null);

    const result = await requestSeatRemovalFromAlert({
      prisma,
      actorEmail: "finops@test.local",
      alert: sampleAlert({ product: "CHATGPT" }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decisionType).toBe("RECLAMATION");
    expect(createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "RECLAMATION",
          subjectUserId: null,
        }),
      }),
    );
  });
});
