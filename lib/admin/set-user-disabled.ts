import type { PrismaClient } from "@prisma/client";

export type SetUserDisabledResult =
  | { ok: true; disabled: boolean; noOp?: boolean; message?: string }
  | { ok: false; status: number; error: string };

/**
 * Disable or re-enable dashboard sign-in for a User row. Writes an append-only
 * Decision (USER_DISABLED / USER_ENABLED). Shared by admin routes and
 * guardrail alert actions.
 */
export async function setUserDisabled(args: {
  prisma: PrismaClient;
  actorEmail: string;
  userId: string;
  disabled: boolean;
  justification?: string;
}): Promise<SetUserDisabledResult> {
  const subject = await args.prisma.user.findUnique({ where: { id: args.userId } });
  if (!subject) {
    return { ok: false, status: 404, error: "user not found" };
  }

  if (args.disabled && subject.isOwner) {
    return { ok: false, status: 409, error: "Cannot disable the dashboard owner." };
  }
  if (args.disabled && subject.email === args.actorEmail) {
    return { ok: false, status: 409, error: "You cannot disable yourself." };
  }

  if (subject.disabled === args.disabled) {
    return {
      ok: true,
      disabled: args.disabled,
      noOp: true,
      message: `User already ${args.disabled ? "disabled" : "enabled"}.`,
    };
  }

  const justification =
    args.justification ??
    (args.disabled ? `Disabled user ${subject.email}` : `Re-enabled user ${subject.email}`);

  await args.prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: args.userId }, data: { disabled: args.disabled } });
    await tx.decision.create({
      data: {
        type: args.disabled ? "USER_DISABLED" : "USER_ENABLED",
        subjectUserId: args.userId,
        beforeState: JSON.stringify({ disabled: subject.disabled }),
        afterState: JSON.stringify({ disabled: args.disabled }),
        actorEmail: args.actorEmail,
        justification,
      },
    });
  });

  return { ok: true, disabled: args.disabled };
}
