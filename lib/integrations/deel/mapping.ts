/**
 * Pure mapping from Deel's `Person` payload (REST + webhook share the
 * shape) to our internal `DeelEmployee`. Lives in its own file so both
 * the real client and the webhook receiver can reuse it.
 */

import type { DeelEmployee } from "./types";

/**
 * Deel `Person` shape — subset of fields the dashboard cares about.
 * Field names follow the Deel API; the mapper insulates the rest of the
 * codebase from any API churn here.
 */
export type DeelPersonRaw = {
  id?: string;
  email?: string;
  work_email?: string;
  full_name?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  /** Free-form role-tag-ish field. Deel calls this `seniority` or
   *  `job_role`/`role_title` depending on workspace config. */
  seniority?: string;
  job_role?: string;
  role_title?: string;
  /** Manager: Deel returns either an embedded mini-person or just
   *  `manager_email`. Honour both. */
  manager_email?: string | null;
  manager?: { email?: string | null } | null;
  /** Country / region. Either `country` (ISO code) or
   *  `working_location.country`. */
  country?: string;
  working_location?: { country?: string };
  /** Status: 'active' / 'inactive' / 'terminated'. */
  status?: string;
};

function compose(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").trim();
}

export function deriveDisplayName(p: DeelPersonRaw): string {
  if (p.display_name) return p.display_name;
  if (p.full_name) return p.full_name;
  const composed = compose(p.first_name, p.last_name);
  if (composed) return composed;
  return p.email ?? p.work_email ?? "";
}

export function deriveRoleTag(p: DeelPersonRaw): string {
  return (
    p.role_title ??
    p.job_role ??
    p.seniority ??
    p.job_title ??
    "untagged"
  );
}

export function deriveStatus(p: DeelPersonRaw): DeelEmployee["status"] {
  const s = (p.status ?? "active").toLowerCase();
  if (s === "terminated") return "TERMINATED";
  if (s === "inactive" || s === "suspended" || s === "on_leave") return "SUSPENDED";
  return "ACTIVE";
}

export function deriveManagerEmail(p: DeelPersonRaw): string | null {
  if (p.manager_email !== undefined) return p.manager_email;
  if (p.manager && p.manager.email !== undefined) return p.manager.email ?? null;
  return null;
}

export function deriveRegion(p: DeelPersonRaw): string {
  return p.country ?? p.working_location?.country ?? "unknown";
}

export function mapDeelPersonToEmployee(p: DeelPersonRaw): DeelEmployee {
  return {
    email: (p.email ?? p.work_email ?? "").toLowerCase(),
    displayName: deriveDisplayName(p),
    roleTag: deriveRoleTag(p),
    managerEmail: deriveManagerEmail(p),
    region: deriveRegion(p),
    status: deriveStatus(p),
  };
}
