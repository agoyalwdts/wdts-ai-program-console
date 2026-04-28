/**
 * STUB / SYNTHETIC — v0.1 deterministic generator.
 *
 * TODO(v0.2): replace with the real `GatewayClient` / `CursorClient` /
 *   `OpenAIClient` / `AnthropicClient` / `M365GraphClient` integrations
 *   described in Dashboard_Scoping_v1.md §4. The synthetic shape mirrors
 *   the planned interface contracts so swap-in is a one-file change in
 *   `prisma/seed.ts`.
 *
 * What this gives v0.1:
 *   - 30 deterministic users (seeded mulberry32 PRNG → identical output every run).
 *   - Realistic-looking spread across roles, regions, products, tiers.
 *   - 100–200 usage records per user across the past 30 days.
 *   - A sprinkling of program-level decisions (tier moves, reclamations, etc.).
 *
 * The generator is intentionally chunky / readable, not clever. v0.2 will
 * replace this file entirely with real API readers.
 */

export type Role =
  | "senior_engineer"
  | "mid_engineer"
  | "documentation_heavy"
  | "contractor"
  | "service_account"
  | "pm_or_ea";

export type SyntheticUser = {
  email: string;
  displayName: string;
  roleTag: string;
  role: Role;
  region: "us-east" | "apac-mo";
  managerEmail?: string;
};

/** Deterministic RNG — mulberry32. Same seed → same sequence forever. */
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

export function rngBetween(rng: () => number, lo: number, hi: number) {
  return lo + (hi - lo) * rng();
}

export function rngInt(rng: () => number, lo: number, hi: number) {
  return Math.floor(rngBetween(rng, lo, hi + 1));
}

const FIRST = [
  "Aiden", "Maya", "Priya", "Ravi", "Lin", "Wei", "Hana", "Ben", "Chloe", "Diego",
  "Elena", "Farah", "Gus", "Hugo", "Iris", "Jin", "Kai", "Leo", "Mira", "Noah",
  "Owen", "Pia", "Quinn", "Rosa", "Sam", "Tara", "Uma", "Vince", "Will", "Xenia",
  "Yara", "Zane",
];
const LAST = [
  "Walker", "Liu", "Patel", "Costa", "Nguyen", "Smith", "Singh", "Park", "Goyal",
  "Tanaka", "Khan", "Mendes", "Rivera", "Jensen", "Choi", "Wang", "Holland",
  "Hartley", "OBrien", "Schultz",
];

/** Stable list of 30 archetype users (deterministic ordering, no RNG). */
export const ROLES_PLAN: { role: Role; roleTag: string; count: number }[] = [
  { role: "senior_engineer",      roleTag: "sw_engineer_senior", count: 8  },
  { role: "mid_engineer",         roleTag: "sw_engineer",        count: 12 },
  { role: "documentation_heavy",  roleTag: "tech_writer",        count: 5  },
  { role: "contractor",           roleTag: "contractor",         count: 3  },
  { role: "service_account",      roleTag: "service_account",    count: 2  },
];
// 8 + 12 + 5 + 3 + 2 = 30

/** Doc-heavy specific role tags rotate through this set. */
export const DOC_ROLE_TAGS = [
  "tech_writer",
  "compliance",
  "legal",
  "internal_comms",
  "executive_assistant",
];

export function buildUsers(seed = 1337): SyntheticUser[] {
  const rng = makeRng(seed);
  const users: SyntheticUser[] = [];
  let idx = 0;

  for (const plan of ROLES_PLAN) {
    for (let i = 0; i < plan.count; i++) {
      const first = FIRST[idx % FIRST.length]!;
      const last = LAST[(idx * 3 + 7) % LAST.length]!;
      const displayName = `${first} ${last}`;
      const emailLocal = `${first}.${last}`.toLowerCase();
      const region: "us-east" | "apac-mo" =
        // 2 users in apac-mo (Macau — to demo §3.3 jurisdictional case in F2).
        (idx === 5 || idx === 19) ? "apac-mo" : "us-east";

      let roleTag = plan.roleTag;
      if (plan.role === "documentation_heavy") {
        roleTag = DOC_ROLE_TAGS[i % DOC_ROLE_TAGS.length]!;
      }

      users.push({
        email: `${emailLocal}@wdts.com`,
        displayName,
        role: plan.role,
        roleTag,
        region,
      });
      idx++;
    }
  }

  // Light, deterministic management graph: every non-senior reports to a senior.
  const seniors = users.filter((u) => u.role === "senior_engineer");
  users.forEach((u, i) => {
    if (u.role === "senior_engineer" || u.role === "service_account") return;
    u.managerEmail = seniors[i % seniors.length]!.email;
  });

  void rng;
  return users;
}
