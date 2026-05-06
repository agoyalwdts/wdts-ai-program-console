export type CodexWorkspaceDay = {
  date: string;
  credits: number;
  users: number;
  threads: number;
  turns: number;
  clients: { client_id: string; credits: number; users: number }[];
};

export type ParsedCodexWorkspaceJson = {
  days: CodexWorkspaceDay[];
};

export function parseCodexWorkspaceJson(text: string): ParsedCodexWorkspaceJson {
  const raw = JSON.parse(text) as { data?: unknown };
  if (!Array.isArray(raw.data)) {
    throw new Error("Codex workspace JSON: expected { data: array }");
  }
  const days: CodexWorkspaceDay[] = [];
  for (const row of raw.data) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date : "";
    const totals = o.totals && typeof o.totals === "object" ? (o.totals as Record<string, unknown>) : {};
    const credits = typeof totals.credits === "number" ? totals.credits : Number(totals.credits);
    if (!date || Number.isNaN(credits)) continue;
    const users = typeof totals.users === "number" ? totals.users : Number(totals.users) || 0;
    const threads = typeof totals.threads === "number" ? totals.threads : Number(totals.threads) || 0;
    const turns = typeof totals.turns === "number" ? totals.turns : Number(totals.turns) || 0;
    const clientsRaw = Array.isArray(o.clients) ? o.clients : [];
    const clients = clientsRaw
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const cr = c as Record<string, unknown>;
        const client_id = typeof cr.client_id === "string" ? cr.client_id : "";
        const cc = typeof cr.credits === "number" ? cr.credits : Number(cr.credits);
        const cu = typeof cr.users === "number" ? cr.users : Number(cr.users) || 0;
        if (!client_id || Number.isNaN(cc)) return null;
        return { client_id, credits: cc, users: cu };
      })
      .filter((x): x is { client_id: string; credits: number; users: number } => x != null);

    days.push({ date, credits, users, threads, turns, clients });
  }
  if (days.length === 0) {
    throw new Error("Codex workspace JSON: no daily rows parsed");
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}
