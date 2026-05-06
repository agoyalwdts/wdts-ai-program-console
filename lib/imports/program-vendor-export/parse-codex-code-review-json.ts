export type CodexCodeReviewDay = {
  date: string;
  n_reviews: number;
  n_comments: number;
  comments_per_review: number;
};

export type ParsedCodexCodeReviewJson = {
  days: CodexCodeReviewDay[];
};

export function parseCodexCodeReviewJson(text: string): ParsedCodexCodeReviewJson {
  const raw = JSON.parse(text) as { data?: unknown };
  if (!Array.isArray(raw.data)) {
    throw new Error("Codex code review JSON: expected { data: array }");
  }
  const days: CodexCodeReviewDay[] = [];
  for (const row of raw.data) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date : "";
    const n_reviews = typeof o.n_reviews === "number" ? o.n_reviews : Number(o.n_reviews);
    const n_comments = typeof o.n_comments === "number" ? o.n_comments : Number(o.n_comments);
    const cpr =
      typeof o.comments_per_review === "number"
        ? o.comments_per_review
        : Number(o.comments_per_review);
    if (!date || Number.isNaN(n_reviews)) continue;
    days.push({
      date,
      n_reviews,
      n_comments: Number.isNaN(n_comments) ? 0 : n_comments,
      comments_per_review: Number.isNaN(cpr) ? 0 : cpr,
    });
  }
  if (days.length === 0) {
    throw new Error("Codex code review JSON: no rows");
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}
