/** Local calendar noon bucket (matches other F1 vendor merge helpers). */
export function calendarDayAtNoonFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!y || !m || !d) {
    throw new Error(`invalid YMD: ${ymd}`);
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Inclusive calendar-day count between two YYYY-MM-DD strings. */
export function inclusiveDayCountYmd(startYmd: string, endYmd: string): number {
  const a = calendarDayAtNoonFromYmd(startYmd);
  const b = calendarDayAtNoonFromYmd(endYmd);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000) + 1;
}

/** Yields YYYY-MM-DD strings from start through end inclusive. */
export function* eachYmdInclusive(startYmd: string, endYmd: string): Generator<string> {
  const cur = new Date(calendarDayAtNoonFromYmd(startYmd));
  const end = calendarDayAtNoonFromYmd(endYmd);
  const pad = (n: number) => String(n).padStart(2, "0");
  while (cur.getTime() <= end.getTime()) {
    yield `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
    cur.setDate(cur.getDate() + 1);
  }
}
