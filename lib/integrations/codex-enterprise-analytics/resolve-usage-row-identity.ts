import { normCodexAnalyticsEmail } from "./aggregate-per-user-mtd";
import type { CodexUsageRow } from "./types";

/** Canonical analytics `user_id` (actor wins over legacy top-level field). */
export function codexUsageRowUserId(row: CodexUsageRow): string | null {
  const fromActor = row.actor?.user_id?.trim();
  if (fromActor) return fromActor;
  const top = row.user_id?.trim();
  return top || null;
}

export function resolveCodexUsageRowEmail(
  row: CodexUsageRow,
  userIdToEmail?: ReadonlyMap<string, string>,
): string | null {
  const actorEmail = row.actor?.email?.trim();
  if (actorEmail && actorEmail.includes("@")) {
    return normCodexAnalyticsEmail(actorEmail);
  }

  const raw = row.email?.trim();
  if (raw && raw.includes("@")) return normCodexAnalyticsEmail(raw);

  const uid = codexUsageRowUserId(row);
  if (!uid || !userIdToEmail) return null;

  const direct = userIdToEmail.get(uid);
  if (direct?.includes("@")) return normCodexAnalyticsEmail(direct);

  if (uid.startsWith("openai-org:")) {
    const orgId = uid.slice("openai-org:".length);
    const viaOrg = userIdToEmail.get(orgId);
    if (viaOrg?.includes("@")) return normCodexAnalyticsEmail(viaOrg);
  }

  return null;
}
