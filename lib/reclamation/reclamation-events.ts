import type {
  PrismaClient,
  Product,
  ReclamationAction,
  ReclamationState,
  ReclamationTrigger,
} from "@prisma/client";
import { getPolicyRepoClient } from "@/lib/integrations";
import type { PolicyRepoClient } from "@/lib/integrations/policyrepo/types";
import { addBusinessDays } from "@/lib/datetime/business-days";
import { buildCursorReclamationFile } from "@/lib/policy/cursor-tier";
import { RECLAMATION_DISPUTE_BUSINESS_DAYS } from "@/lib/program";

export type ReclamationSummary = {
  id: string;
  state: ReclamationState;
  subjectUserId: string;
  subjectEmail: string;
  subjectDisplayName: string;
  product: Product | null;
  disputeWindowEndsAt: Date | null;
  decisionId: string | null;
  prUrl: string | null;
};

const OPEN_STATES: ReclamationState[] = ["NOTIFIED", "IN_DISPUTE"];

export async function findOpenReclamationForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<{ id: string } | null> {
  return prisma.reclamationEvent.findFirst({
    where: { subjectUserId: userId, state: { in: OPEN_STATES } },
    select: { id: true },
  });
}

export type CreateReclamationResult =
  | { ok: true; event: ReclamationSummary }
  | { ok: false; status: number; error: string };

export async function createReclamationEvent(args: {
  prisma: PrismaClient;
  actorEmail: string;
  userId: string;
  product: Product;
  trigger: ReclamationTrigger;
  action?: ReclamationAction;
  justification: string;
}): Promise<CreateReclamationResult> {
  const justification = args.justification.trim();
  if (justification.length < 10) {
    return { ok: false, status: 400, error: "Justification must be at least 10 characters." };
  }

  const license = await args.prisma.license.findUnique({
    where: { userId_product: { userId: args.userId, product: args.product } },
    include: { user: true },
  });
  if (!license) {
    return {
      ok: false,
      status: 404,
      error: `User has no ${args.product} license row.`,
    };
  }

  const existing = await findOpenReclamationForUser(args.prisma, args.userId);
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "An open reclamation already exists for this user.",
    };
  }

  const action = args.action ?? "NOTIFY";
  const now = new Date();
  const disputeWindowEndsAt =
    action === "NOTIFY"
      ? addBusinessDays(now, RECLAMATION_DISPUTE_BUSINESS_DAYS)
      : null;

  const event = await args.prisma.reclamationEvent.create({
    data: {
      subjectUserId: args.userId,
      licenseId: license.id,
      trigger: args.trigger,
      action,
      state: "NOTIFIED",
      triggeredAt: now,
      notifiedAt: action === "NOTIFY" ? now : null,
      disputeWindowEndsAt,
      justification,
    },
    include: { subject: true, license: true },
  });

  if (action === "RECLAIM") {
    const finalized = await finalizeReclamationReclaim({
      prisma: args.prisma,
      eventId: event.id,
      actorEmail: args.actorEmail,
      resolvedByEmail: args.actorEmail,
      terminalState: "RESOLVED_RECLAIMED",
    });
    if (!finalized.ok) {
      return finalized;
    }
    return {
      ok: true,
      event: finalized.event,
    };
  }

  return {
    ok: true,
    event: toSummary(event, null),
  };
}

export type DisputeReclamationResult =
  | { ok: true; event: ReclamationSummary }
  | { ok: false; status: number; error: string };

export async function disputeReclamationEvent(args: {
  prisma: PrismaClient;
  eventId: string;
  actorEmail: string;
  disputeReason: string;
}): Promise<DisputeReclamationResult> {
  const reason = args.disputeReason.trim();
  if (reason.length < 10) {
    return { ok: false, status: 400, error: "Dispute reason must be at least 10 characters." };
  }

  const event = await args.prisma.reclamationEvent.findUnique({
    where: { id: args.eventId },
    include: { subject: { include: { manager: true } }, license: true, decision: true },
  });
  if (!event) {
    return { ok: false, status: 404, error: "Reclamation event not found." };
  }
  if (event.state !== "NOTIFIED") {
    return { ok: false, status: 409, error: "Only NOTIFIED events can be disputed." };
  }
  if (event.disputeWindowEndsAt && event.disputeWindowEndsAt.getTime() <= Date.now()) {
    return { ok: false, status: 409, error: "Dispute window has closed." };
  }

  const actorEmail = args.actorEmail.toLowerCase();
  const subjectEmail = event.subject.email.toLowerCase();
  const managerEmail = event.subject.manager?.email.toLowerCase();
  if (actorEmail !== subjectEmail && actorEmail !== managerEmail) {
    return {
      ok: false,
      status: 403,
      error: "Only the subject or their manager may dispute this reclamation.",
    };
  }

  const updated = await args.prisma.reclamationEvent.update({
    where: { id: event.id },
    data: {
      state: "IN_DISPUTE",
      disputedAt: new Date(),
      disputedByEmail: args.actorEmail,
      disputeReason: reason,
    },
    include: { subject: true, license: true, decision: true },
  });

  return { ok: true, event: toSummary(updated, updated.decision?.evidenceLink ?? null) };
}

export type ResolveReclamationResult =
  | { ok: true; event: ReclamationSummary }
  | { ok: false; status: number; error: string; decisionId?: string };

export async function resolveReclamationEvent(args: {
  prisma: PrismaClient;
  eventId: string;
  actorEmail: string;
  outcome: "retain" | "reclaim";
  note?: string;
  policyRepo?: PolicyRepoClient;
}): Promise<ResolveReclamationResult> {
  const event = await args.prisma.reclamationEvent.findUnique({
    where: { id: args.eventId },
    include: { subject: true, license: true },
  });
  if (!event) {
    return { ok: false, status: 404, error: "Reclamation event not found." };
  }
  if (!OPEN_STATES.includes(event.state)) {
    return { ok: false, status: 409, error: "Reclamation is already closed." };
  }

  if (args.outcome === "retain") {
    const updated = await args.prisma.reclamationEvent.update({
      where: { id: event.id },
      data: {
        state: "RESOLVED_RETAINED",
        resolvedAt: new Date(),
        resolvedByEmail: args.actorEmail,
      },
      include: { subject: true, license: true },
    });

    const decision = await args.prisma.decision.create({
      data: {
        type: "RECLAMATION",
        subjectUserId: event.subjectUserId,
        beforeState: JSON.stringify({
          reclamationEventId: event.id,
          state: event.state,
          product: event.license?.product ?? null,
        }),
        afterState: JSON.stringify({
          state: "RESOLVED_RETAINED",
          seatRetained: true,
        }),
        actorEmail: args.actorEmail,
        justification:
          args.note?.trim() ||
          `Reclamation ${event.id} resolved — seat retained after review.`,
      },
    });

    await args.prisma.reclamationEvent.update({
      where: { id: event.id },
      data: { decisionId: decision.id },
    });

    return {
      ok: true,
      event: toSummary({ ...updated, decisionId: decision.id }, null),
    };
  }

  return finalizeReclamationReclaim({
    prisma: args.prisma,
    eventId: event.id,
    actorEmail: args.actorEmail,
    resolvedByEmail: args.actorEmail,
    terminalState: "RESOLVED_RECLAIMED",
    note: args.note,
    policyRepo: args.policyRepo,
  });
}

export type ProcessExpiredSummary = {
  scanned: number;
  expired: number;
  errors: string[];
  eventIds: string[];
};

export async function processExpiredReclamationDisputeWindows(args: {
  prisma: PrismaClient;
  now?: Date;
  policyRepo?: PolicyRepoClient;
  dryRun?: boolean;
}): Promise<ProcessExpiredSummary> {
  const now = args.now ?? new Date();
  const due = await args.prisma.reclamationEvent.findMany({
    where: {
      state: "NOTIFIED",
      disputeWindowEndsAt: { lte: now },
    },
    orderBy: { disputeWindowEndsAt: "asc" },
  });

  const summary: ProcessExpiredSummary = {
    scanned: due.length,
    expired: 0,
    errors: [],
    eventIds: [],
  };

  if (args.dryRun) {
    summary.eventIds = due.map((e) => e.id);
    return summary;
  }

  for (const row of due) {
    const result = await finalizeReclamationReclaim({
      prisma: args.prisma,
      eventId: row.id,
      actorEmail: "cron@wdts-ai-program-console",
      resolvedByEmail: "cron@wdts-ai-program-console",
      terminalState: "EXPIRED",
      note: "Dispute window elapsed with no dispute — auto-reclaim per §4.6.4.",
      policyRepo: args.policyRepo,
    });
    if (result.ok) {
      summary.expired += 1;
      summary.eventIds.push(row.id);
    } else {
      summary.errors.push(`${row.id}: ${result.error}`);
    }
  }

  return summary;
}

async function finalizeReclamationReclaim(args: {
  prisma: PrismaClient;
  eventId: string;
  actorEmail: string;
  resolvedByEmail: string;
  terminalState: "RESOLVED_RECLAIMED" | "EXPIRED";
  note?: string;
  policyRepo?: PolicyRepoClient;
}): Promise<ResolveReclamationResult> {
  const event = await args.prisma.reclamationEvent.findUnique({
    where: { id: args.eventId },
    include: { subject: true, license: true },
  });
  if (!event) {
    return { ok: false, status: 404, error: "Reclamation event not found." };
  }
  if (event.decisionId) {
    return { ok: false, status: 409, error: "Reclamation already finalized." };
  }

  const product = event.license?.product ?? "CURSOR";
  const decisionType = product === "CURSOR" ? "CURSOR_SEAT_RECLAIM" : "RECLAMATION";
  const justification =
    args.note?.trim() ||
    `Reclamation ${event.id} finalized as ${args.terminalState}: ${event.justification}`;

  const decision = await args.prisma.decision.create({
    data: {
      type: decisionType,
      subjectUserId: event.subjectUserId,
      beforeState: JSON.stringify({
        reclamationEventId: event.id,
        state: event.state,
        licenseSubTier: event.license?.subTier ?? null,
        product,
      }),
      afterState: JSON.stringify({
        state: args.terminalState,
        seatReclaimed: true,
      }),
      actorEmail: args.actorEmail,
      justification,
    },
  });

  let prUrl: string | null = null;
  if (product === "CURSOR" && event.license) {
    const policyRepo = args.policyRepo ?? getPolicyRepoClient();
    const policyFile = buildCursorReclamationFile({
      decisionId: decision.id,
      reclamationEventId: event.id,
      email: event.subject.email,
      licenseSubTier: event.license.subTier,
      justification,
      actorEmail: args.actorEmail,
    });
    try {
      const pr = await policyRepo.openPullRequest({
        decisionId: decision.id,
        authorEmail: args.actorEmail,
        title: `Cursor seat reclamation: ${event.subject.email}`,
        body: justification,
        files: [policyFile],
      });
      prUrl = pr.url;
      await args.prisma.decision.update({
        where: { id: decision.id },
        data: { evidenceLink: pr.url },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 502,
        error: `Policy repo PR failed: ${message}`,
        decisionId: decision.id,
      };
    }
  }

  const updated = await args.prisma.reclamationEvent.update({
    where: { id: event.id },
    data: {
      state: args.terminalState,
      resolvedAt: new Date(),
      resolvedByEmail: args.resolvedByEmail,
      decisionId: decision.id,
    },
    include: { subject: true, license: true },
  });

  return {
    ok: true,
    event: toSummary({ ...updated, decisionId: decision.id }, prUrl),
  };
}

function toSummary(
  event: {
    id: string;
    state: ReclamationState;
    subjectUserId: string;
    disputeWindowEndsAt: Date | null;
    decisionId: string | null;
    subject: { email: string; displayName: string };
    license: { product: Product } | null;
  },
  prUrl: string | null,
): ReclamationSummary {
  return {
    id: event.id,
    state: event.state,
    subjectUserId: event.subjectUserId,
    subjectEmail: event.subject.email,
    subjectDisplayName: event.subject.displayName,
    product: event.license?.product ?? null,
    disputeWindowEndsAt: event.disputeWindowEndsAt,
    decisionId: event.decisionId,
    prUrl,
  };
}
