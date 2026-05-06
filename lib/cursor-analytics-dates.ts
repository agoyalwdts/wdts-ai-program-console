/**
 * Map F1-aligned analytics date strings to epoch ms for Cursor Admin POST bodies
 * (e.g. {@link https://cursor.com/docs/account/teams/admin-api daily-usage-data}).
 */

/** Cursor `/teams/daily-usage-data` rejects ranges over 30 days. */
export const CURSOR_DAILY_USAGE_MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @param startDate - `YYYY-MM-DD` or Cursor relative shortcut (fallback: 30d window ending at endMs)
 * @param endDate - `YYYY-MM-DD` or `today`
 */
export function analyticsWindowToEpochMs(args: {
  startDate: string;
  endDate: string;
}): { startMs: number; endMs: number } {
  const now = Date.now();
  let endMs: number;
  if (args.endDate === "today") {
    endMs = now;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(args.endDate)) {
    endMs = Date.parse(`${args.endDate}T23:59:59.999Z`);
  } else {
    endMs = now;
  }

  let startMs: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(args.startDate)) {
    startMs = Date.parse(`${args.startDate}T00:00:00.000Z`);
  } else {
    const m = /^(\d+)d$/i.exec(args.startDate.trim());
    if (m) {
      const days = Math.min(Math.max(Number(m[1]) || 7, 1), 30);
      startMs = endMs - days * 24 * 60 * 60 * 1000;
    } else {
      startMs = endMs - 7 * 24 * 60 * 60 * 1000;
    }
  }

  if (endMs - startMs > CURSOR_DAILY_USAGE_MAX_RANGE_MS) {
    startMs = endMs - CURSOR_DAILY_USAGE_MAX_RANGE_MS;
  }
  if (startMs > endMs) {
    startMs = endMs - 24 * 60 * 60 * 1000;
  }
  return { startMs, endMs };
}
