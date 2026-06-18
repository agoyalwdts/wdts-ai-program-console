/**
 * Business-day calendar math for reclamation dispute windows (§4.6.4).
 * Weekends (Sat/Sun) are skipped; no holiday calendar in v0.4.
 */

export function addBusinessDays(start: Date, businessDays: number): Date {
  if (businessDays <= 0) return new Date(start);
  const result = new Date(start);
  let remaining = businessDays;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return result;
}

export function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}
