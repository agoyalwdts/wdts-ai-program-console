import Papa from "papaparse";
import { inclusiveDayCountYmd } from "./dates";

export type ChatgptUsersCsvRow = {
  email: string;
  name: string;
  credits_used: number;
  messages: number;
  user_status: string;
  messages_rank: string;
};

export type ParsedChatgptUsersCsv = {
  periodStart: string;
  periodEnd: string;
  rows: ChatgptUsersCsvRow[];
  totalCredits: number;
  totalMessages: number;
};

export function parseChatgptUsersCsv(text: string): ParsedChatgptUsersCsv {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parse error");
  }
  const data = parsed.data.filter((r) => Object.keys(r).length > 0);
  if (data.length === 0) {
    throw new Error("no rows in ChatGPT users CSV");
  }

  const first = data[0];
  const periodStart = (first.period_start ?? first["period_start"])?.trim();
  const periodEnd = (first.period_end ?? first["period_end"])?.trim();
  if (!periodStart || !periodEnd) {
    throw new Error("ChatGPT users CSV missing period_start / period_end");
  }

  const rows: ChatgptUsersCsvRow[] = [];
  let totalCredits = 0;
  let totalMessages = 0;

  for (const r of data) {
    const email = (r.email ?? "").trim();
    if (!email.includes("@")) continue;
    const creditsRaw = (r.credits_used ?? "").trim();
    const messagesRaw = (r.messages ?? "").trim();
    if (creditsRaw === "" && messagesRaw === "") continue;
    const credits = creditsRaw === "" ? 0 : Number(creditsRaw);
    if (Number.isNaN(credits)) continue;
    const messages = messagesRaw === "" ? 0 : Number(messagesRaw);
    if (Number.isNaN(messages)) continue;

    rows.push({
      email,
      name: (r.name ?? "").trim(),
      credits_used: credits,
      messages,
      user_status: (r.user_status ?? "").trim(),
      messages_rank: (r.messages_rank ?? "").trim(),
    });
    totalCredits += credits;
    totalMessages += messages;
  }

  if (rows.length === 0) {
    throw new Error("no user rows with email + numeric credits in ChatGPT users CSV");
  }

  inclusiveDayCountYmd(periodStart, periodEnd);

  return { periodStart, periodEnd, rows, totalCredits, totalMessages };
}
