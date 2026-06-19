/**
 * FinOps-maintained cost-centre allowlist (ADR 0002).
 * Keys: "<BU>-<glCode>", ASCII uppercase, max 32 chars.
 */

export const COST_CENTRE_PATTERN = /^[A-Z0-9]+-[A-Z0-9]{2,8}$/;

/** Seed + dev placeholder codes until FinOps publishes the real list. */
export const ALLOWED_COST_CENTRES = [
  "ENG-4501",
  "ENG-4502",
  "ENG-4503",
  "FINOPS-7101",
  "COMPLIANCE-7102",
  "PRODUCT-3201",
] as const;

export type CostCentreKey = (typeof ALLOWED_COST_CENTRES)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_COST_CENTRES);

export function isCostCentre(value: string | null | undefined): value is CostCentreKey {
  if (!value || value.length > 32) return false;
  if (!COST_CENTRE_PATTERN.test(value)) return false;
  return ALLOWED_SET.has(value);
}

/** Deterministic seed assignment from email hash. */
export function seedCostCentreForEmail(email: string): CostCentreKey {
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  }
  return ALLOWED_COST_CENTRES[h % ALLOWED_COST_CENTRES.length]!;
}

export function costCentreLabel(key: string | null): string {
  if (!key) return "Unassigned";
  return key;
}
