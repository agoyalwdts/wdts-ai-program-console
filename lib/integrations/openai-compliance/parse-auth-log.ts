/**
 * Best-effort JSONL parser for Compliance AUTH_LOG payloads (schema varies by event version).
 */

function normEmail(v: unknown): string | null {
  if (typeof v !== "string" || !v.includes("@")) return null;
  return v.trim().toLowerCase();
}

function normIp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const ip = v.trim();
  return ip.length > 0 ? ip : null;
}

function walk(obj: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) walk(item, visit);
    return;
  }
  const rec = obj as Record<string, unknown>;
  visit(rec);
  for (const v of Object.values(rec)) walk(v, visit);
}

const EMAIL_KEYS = new Set([
  "email",
  "user_email",
  "useremail",
  "userprincipalname",
  "actor_email",
]);

const IP_KEYS = new Set([
  "ip",
  "ip_address",
  "ipaddress",
  "client_ip",
  "clientip",
  "source_ip",
]);

export function extractAuthEventsFromLogBody(
  body: string,
  targetEmail: string,
): { ips: string[]; eventCount: number } {
  const target = targetEmail.trim().toLowerCase();
  const ips = new Set<string>();
  let eventCount = 0;

  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    walk(parsed, (rec) => {
      let email: string | null = null;
      let ip: string | null = null;
      for (const [k, v] of Object.entries(rec)) {
        const key = k.toLowerCase();
        if (!email && EMAIL_KEYS.has(key)) email = normEmail(v);
        if (!ip && IP_KEYS.has(key)) ip = normIp(v);
      }
      if (email === target) {
        eventCount += 1;
        if (ip) ips.add(ip);
      }
    });
  }

  return { ips: [...ips], eventCount };
}
