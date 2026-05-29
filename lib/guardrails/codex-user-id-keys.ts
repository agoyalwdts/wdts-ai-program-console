import { normCodexAnalyticsEmail } from "@/lib/integrations/codex-enterprise-analytics/aggregate-per-user-mtd";

/** Register all key shapes we see on Codex analytics buckets vs roster APIs. */
export function registerCodexAnalyticsUserIdEmail(
  map: Map<string, string>,
  userId: string,
  email: string,
): void {
  const uid = userId.trim();
  const norm = normCodexAnalyticsEmail(email);
  if (!uid || !norm.includes("@")) return;

  map.set(uid, norm);

  if (uid.startsWith("openai-org:")) {
    map.set(uid.slice("openai-org:".length), norm);
  } else {
    map.set(`openai-org:${uid}`, norm);
  }
}
