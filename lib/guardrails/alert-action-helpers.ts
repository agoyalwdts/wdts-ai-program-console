import type { GuardrailPolicyAlert, PrismaClient, Product } from "@prisma/client";
import { sendGuardrailUserCoachingEmail } from "@/lib/notify/user-coaching-email";
import { userCoachingBccList } from "@/lib/notify/user-coaching-config";

export const GUARDRAIL_ALERT_ACTION_SELECT = {
  id: true,
  occurredAt: true,
  category: true,
  severity: true,
  product: true,
  userEmail: true,
  model: true,
  ruleCode: true,
  title: true,
  rationale: true,
  recommendation: true,
  acknowledgedAt: true,
  userEmailNotifiedAt: true,
} as const;

export type GuardrailAlertForAction = Pick<
  GuardrailPolicyAlert,
  keyof typeof GUARDRAIL_ALERT_ACTION_SELECT
>;

export async function loadGuardrailAlertForAction(
  prisma: PrismaClient,
  id: string,
): Promise<GuardrailAlertForAction | null> {
  return prisma.guardrailPolicyAlert.findUnique({
    where: { id },
    select: GUARDRAIL_ALERT_ACTION_SELECT,
  });
}

export async function findUserIdByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<{ id: string; email: string; disabled: boolean; isOwner: boolean } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, disabled: true, isOwner: true },
  });
}

export type SendAlertCoachingEmailResult =
  | { ok: true; skipped: false; resent: boolean }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; status: number; error: string };

/** Manual coaching email for one alert (any rule code). */
export async function sendAlertCoachingEmail(
  prisma: PrismaClient,
  alert: GuardrailAlertForAction,
): Promise<SendAlertCoachingEmailResult> {
  const email = alert.userEmail?.trim().toLowerCase();
  if (!email) {
    return { ok: false, status: 400, error: "Alert has no user email." };
  }

  const user = await findUserIdByEmail(prisma, email);
  if (!user) {
    return {
      ok: false,
      status: 404,
      error: `No User row for ${email}. Invite them under Settings → Users first.`,
    };
  }
  if (user.disabled) {
    return {
      ok: false,
      status: 409,
      error: "User is disabled on the dashboard — re-enable before sending coaching mail.",
    };
  }

  const resent = alert.userEmailNotifiedAt !== null;
  const mail = await sendGuardrailUserCoachingEmail({
    to: email,
    lines: [
      {
        ruleCode: alert.ruleCode,
        title: alert.title,
        rationale: alert.rationale,
        recommendation: alert.recommendation,
        product: alert.product,
        model: alert.model,
      },
    ],
    bcc: userCoachingBccList(),
  });

  if (mail.ok && mail.skipped) {
    return { ok: true, skipped: true, reason: mail.reason };
  }
  if (!mail.ok) {
    return { ok: false, status: 502, error: mail.error };
  }

  await prisma.guardrailPolicyAlert.update({
    where: { id: alert.id },
    data: { userEmailNotifiedAt: new Date() },
  });

  return { ok: true, skipped: false, resent };
}

export type RequestSeatRemovalResult =
  | { ok: true; decisionId: string; decisionType: "CURSOR_SEAT_RECLAIM" | "RECLAMATION" }
  | { ok: false; status: number; error: string };

/**
 * Logs an operator request to remove vendor access. Does not call Cursor SCIM
 * or other vendor APIs — policy-repo / reclamation automation is F6/F7.
 */
export async function requestSeatRemovalFromAlert(args: {
  prisma: PrismaClient;
  actorEmail: string;
  alert: GuardrailAlertForAction;
  note?: string;
}): Promise<RequestSeatRemovalResult> {
  const email = args.alert.userEmail?.trim().toLowerCase();
  if (!email) {
    return { ok: false, status: 400, error: "Alert has no user email." };
  }

  const user = await findUserIdByEmail(args.prisma, email);
  const product = args.alert.product ?? null;
  const decisionType =
    product === "CURSOR" ? ("CURSOR_SEAT_RECLAIM" as const) : ("RECLAMATION" as const);

  const beforeState = JSON.stringify({
    alertId: args.alert.id,
    ruleCode: args.alert.ruleCode,
    product,
    model: args.alert.model,
    occurredAt: args.alert.occurredAt.toISOString(),
    severity: args.alert.severity,
  });
  const afterState = JSON.stringify({
    status: "REQUESTED",
    pendingPolicyRepoPr: true,
    pendingVendorAutomation: true,
    product,
  });

  const noteSuffix = args.note?.trim() ? ` Operator note: ${args.note.trim()}` : "";
  const justification =
    `Guardrail alert ${args.alert.id}: request ${product ?? "program"} access removal for ${email} ` +
    `(${args.alert.ruleCode} — ${args.alert.title}).${noteSuffix} ` +
    `No vendor API call from the dashboard — follow policy-repo / reclamation runbook.`;

  const decision = await args.prisma.decision.create({
    data: {
      type: decisionType,
      subjectUserId: user?.id ?? null,
      beforeState,
      afterState,
      actorEmail: args.actorEmail,
      justification,
      evidenceLink: `/settings/guardrails#alert-${args.alert.id}`,
    },
  });

  return { ok: true, decisionId: decision.id, decisionType };
}

export function productLabel(product: Product | null): string {
  if (!product) return "program";
  return product.replace(/_/g, " ");
}
