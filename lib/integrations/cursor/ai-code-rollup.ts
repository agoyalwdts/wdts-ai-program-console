/**
 * Aggregate {@link https://cursor.com/docs/account/teams/ai-code-tracking-api AI Code Tracking}
 * commit payloads for Analytics dashboards (daily by source, repository table).
 */

import type { Fetch } from "../_http";
import { cursorTeamGetJson } from "./cursor-team-http";

export type AiCodeCommitItem = {
  commitHash?: string;
  repoName?: string | null;
  branchName?: string | null;
  isPrimaryBranch?: boolean | null;
  commitSource?: string | null;
  totalLinesAdded?: number;
  totalLinesDeleted?: number;
  tabLinesAdded?: number;
  tabLinesDeleted?: number;
  composerLinesAdded?: number;
  composerLinesDeleted?: number;
  nonAiLinesAdded?: number | null;
  nonAiLinesDeleted?: number | null;
  commitTs?: string | null;
};

type AiCommitsPage = {
  items?: AiCodeCommitItem[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
};

export type AiCodeDailyRow = {
  /** YYYY-MM-DD */
  dayKey: string;
  /** Short label for charts */
  label: string;
  ide: number;
  cli: number;
  cloud: number;
  other: number;
  /** 0–100 */
  aiPct: number;
};

export type AiCodeRepoRow = {
  repo: string;
  aiLines: number;
  totalLines: number;
  pct: number;
};

export type AiCodeRollupTotals = {
  /** Weighted by lines added */
  aiSharePct: number;
  tabLines: number;
  composerLines: number;
  totalLinesAdded: number;
  commitCount: number;
};

export type AiCodeRollup = {
  daily: AiCodeDailyRow[];
  repos: AiCodeRepoRow[];
  totals: AiCodeRollupTotals;
};

const MAX_DEFAULT_PAGES = 25;
const DEFAULT_PAGE_SIZE = 1000;

function utcYmdFromIso(ts: string | null | undefined): string | null {
  if (!ts?.trim()) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shortDayLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sourceBucket(source: string | null | undefined): "ide" | "cli" | "cloud" | "other" {
  const s = (source ?? "").toLowerCase();
  if (s === "ide") return "ide";
  if (s === "cli") return "cli";
  if (s === "cloud") return "cloud";
  return "other";
}

export async function fetchAllAiCodeCommitsForWindow(args: {
  apiKey: string;
  startDate: string;
  endDate: string;
  fetchImpl?: Fetch;
  maxPages?: number;
  pageSize?: number;
}): Promise<AiCodeCommitItem[]> {
  const pageSize = Math.min(Math.max(args.pageSize ?? DEFAULT_PAGE_SIZE, 1), 1000);
  const maxPages = Math.max(1, Math.min(args.maxPages ?? MAX_DEFAULT_PAGES, 100));
  const out: AiCodeCommitItem[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const res = await cursorTeamGetJson<AiCommitsPage>({
      path: "/analytics/ai-code/commits",
      query: {
        startDate: args.startDate,
        endDate: args.endDate,
        page: String(page),
        pageSize: String(pageSize),
      },
      apiKey: args.apiKey,
      fetchImpl: args.fetchImpl,
    });
    const items = Array.isArray(res.items) ? res.items : [];
    out.push(...items);
    if (items.length < pageSize) break;
    if (typeof res.totalCount === "number" && res.totalCount > 0 && out.length >= res.totalCount) {
      break;
    }
  }
  return out;
}

export function rollupAiCodeCommits(items: AiCodeCommitItem[]): AiCodeRollup {
  const byDay = new Map<
    string,
    { ide: number; cli: number; cloud: number; other: number; aiLines: number; totalLines: number }
  >();
  const byRepo = new Map<string, { aiLines: number; totalLines: number }>();

  let sumTab = 0;
  let sumComposer = 0;
  let sumTotal = 0;

  for (const c of items) {
    const total = Number(c.totalLinesAdded) || 0;
    const tab = Number(c.tabLinesAdded) || 0;
    const comp = Number(c.composerLinesAdded) || 0;
    const aiLines = tab + comp;
    sumTab += tab;
    sumComposer += comp;
    sumTotal += total;

    const ymd = utcYmdFromIso(c.commitTs ?? null);
    if (ymd) {
      const b = sourceBucket(c.commitSource);
      const cur = byDay.get(ymd) ?? {
        ide: 0,
        cli: 0,
        cloud: 0,
        other: 0,
        aiLines: 0,
        totalLines: 0,
      };
      cur[b] += total;
      cur.aiLines += aiLines;
      cur.totalLines += total;
      byDay.set(ymd, cur);
    }

    const repo = (c.repoName ?? "").trim() || "(unknown)";
    const r = byRepo.get(repo) ?? { aiLines: 0, totalLines: 0 };
    r.aiLines += aiLines;
    r.totalLines += total;
    byRepo.set(repo, r);
  }

  const daily: AiCodeDailyRow[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, v]) => ({
      dayKey,
      label: shortDayLabel(dayKey),
      ide: v.ide,
      cli: v.cli,
      cloud: v.cloud,
      other: v.other,
      aiPct: v.totalLines > 0 ? (v.aiLines / v.totalLines) * 100 : 0,
    }));

  const repos: AiCodeRepoRow[] = [...byRepo.entries()]
    .map(([repo, v]) => ({
      repo,
      aiLines: v.aiLines,
      totalLines: v.totalLines,
      pct: v.totalLines > 0 ? (v.aiLines / v.totalLines) * 100 : 0,
    }))
    .sort((a, b) => b.aiLines - a.aiLines);

  const totals: AiCodeRollupTotals = {
    aiSharePct: sumTotal > 0 ? ((sumTab + sumComposer) / sumTotal) * 100 : 0,
    tabLines: sumTab,
    composerLines: sumComposer,
    totalLinesAdded: sumTotal,
    commitCount: items.length,
  };

  return { daily, repos, totals };
}
