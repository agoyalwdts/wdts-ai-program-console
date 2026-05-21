import type { PrismaClient } from "@prisma/client";
import {
  guardrailRuleCodesForUserEmail,
  userCoachingBccList,
  userCoachingEmailActive,
} from "./user-coaching-config";
import {
  sendCursorPrudenceUserCoachingEmail,
  sendGuardrailUserCoachingEmail,
  type CursorUserCoachingLine,
  type GuardrailUserCoachingLine,
} from "./user-coaching-email";

export type UserNotifySummary = {
  attempted: number;
  sent: number;
  skippedReason: string | null;
  errors: string[];
};

function groupByEmail<T extends { userEmail: string }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const email = row.userEmail.trim().toLowerCase();
    if (!email) continue;
    const list = map.get(email) ?? [];
    list.push(row);
    map.set(email, list);
  }
  return map;
}

async function activeUserEmails(
  prisma: PrismaClient,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const users = await prisma.user.findMany({
    where: { email: { in: emails }, disabled: false },
    select: { email: true },
  });
  return new Set(users.map((u) => u.email.toLowerCase()));
}

export async function notifyGuardrailAlertUsers(args: {
  prisma: PrismaClient;
  alerts: Array<{
    id: string;
    userEmail: string | null;
    ruleCode: string;
    title: string;
    rationale: string;
    recommendation: string | null;
    product: string | null;
    model: string | null;
  }>;
}): Promise<UserNotifySummary> {
  if (!userCoachingEmailActive()) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: "USER_MODEL_COACHING_EMAIL disabled or not allowed in this APP_ENV",
      errors: [],
    };
  }

  const allowedRules = guardrailRuleCodesForUserEmail();
  const eligible = args.alerts.filter(
    (a) => a.userEmail && allowedRules.has(a.ruleCode),
  );
  if (eligible.length === 0) {
    return { attempted: 0, sent: 0, skippedReason: "no user-coaching eligible alerts", errors: [] };
  }

  const byUser = groupByEmail(
    eligible.map((a) => ({
      ...a,
      userEmail: a.userEmail!.trim().toLowerCase(),
    })),
  );
  const active = await activeUserEmails(args.prisma, [...byUser.keys()]);
  const bcc = userCoachingBccList();
  const errors: string[] = [];
  let sent = 0;
  let attempted = 0;

  for (const [email, rows] of byUser) {
    if (!active.has(email)) continue;
    attempted += 1;
    const lines: GuardrailUserCoachingLine[] = rows.map((r) => ({
      ruleCode: r.ruleCode,
      title: r.title,
      rationale: r.rationale,
      recommendation: r.recommendation,
      product: r.product,
      model: r.model,
    }));
    const mail = await sendGuardrailUserCoachingEmail({ to: email, lines, bcc });
    if (mail.ok && !mail.skipped) {
      sent += 1;
      await args.prisma.guardrailPolicyAlert.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { userEmailNotifiedAt: new Date() },
      });
    } else if (!mail.ok) {
      errors.push(`${email}: ${mail.error}`);
    } else if (mail.skipped) {
      return {
        attempted,
        sent,
        skippedReason: mail.reason,
        errors,
      };
    }
  }

  return { attempted, sent, skippedReason: null, errors };
}

export async function notifyCursorPrudenceAlertUsers(args: {
  prisma: PrismaClient;
  alerts: Array<{
    id: string;
    userEmail: string;
    model: string;
    costUsd: number;
    ruleCode: string;
    title: string;
    rationale: string;
  }>;
  dashboardBaseUrl: string;
}): Promise<UserNotifySummary> {
  if (!userCoachingEmailActive()) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: "USER_MODEL_COACHING_EMAIL disabled or not allowed in this APP_ENV",
      errors: [],
    };
  }

  const byUser = groupByEmail(
    args.alerts.map((a) => ({
      ...a,
      userEmail: a.userEmail.trim().toLowerCase(),
    })),
  );
  if (byUser.size === 0) {
    return { attempted: 0, sent: 0, skippedReason: "no alerts with user email", errors: [] };
  }

  const active = await activeUserEmails(args.prisma, [...byUser.keys()]);
  const bcc = userCoachingBccList();
  const errors: string[] = [];
  let sent = 0;
  let attempted = 0;

  for (const [email, rows] of byUser) {
    if (!active.has(email)) continue;
    attempted += 1;
    const lines: CursorUserCoachingLine[] = rows.map((r) => ({
      ruleCode: r.ruleCode,
      title: r.title,
      rationale: r.rationale,
      model: r.model,
      costUsd: r.costUsd,
    }));
    const mail = await sendCursorPrudenceUserCoachingEmail({
      to: email,
      lines,
      dashboardBaseUrl: args.dashboardBaseUrl,
      bcc,
    });
    if (mail.ok && !mail.skipped) {
      sent += 1;
      await args.prisma.cursorUsagePrudenceAlert.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { userEmailNotifiedAt: new Date() },
      });
    } else if (!mail.ok) {
      errors.push(`${email}: ${mail.error}`);
    } else if (mail.skipped) {
      return {
        attempted,
        sent,
        skippedReason: mail.reason,
        errors,
      };
    }
  }

  return { attempted, sent, skippedReason: null, errors };
}
