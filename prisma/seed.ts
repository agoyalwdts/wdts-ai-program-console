import { PrismaClient } from "@prisma/client";
import {
  buildUsers,
  makeRng,
  pick,
  rngBetween,
  rngInt,
} from "../lib/synthetic-data";
import {
  CHATGPT_CAP_USD_MONTH,
  CLAUDE_CAP_USD_MONTH,
  CODEX_TIERS,
  CURSOR_TIERS,
} from "../lib/program";
import { BUILT_IN_ROLES } from "../lib/rbac/built-in-roles";

const prisma = new PrismaClient();

const OWNER_EMAIL = "agoyal@wdtablesystems.com";
const OWNER_DISPLAY_NAME = "Anuj Goyal";
const OWNER_TITLE = "Chief Technology Officer · Head of AI Task Force";

async function main() {
  console.log("[seed] purging existing rows…");
  await prisma.usageRecord.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.license.deleteMany();
  // Detach users from their role FK before deleting roles, otherwise the
  // role delete would cascade-fail. We'll recreate users below with the
  // fresh role IDs.
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();

  // 1) Seed built-in roles. Idempotent — re-running the seed re-syncs
  //    permissions if a deploy changed the catalogue.
  console.log(`[seed] seeding ${BUILT_IN_ROLES.length} built-in roles…`);
  const roleIdByKey = new Map<string, string>();
  for (const def of BUILT_IN_ROLES) {
    const r = await prisma.role.upsert({
      where: { key: def.key },
      update: {
        displayName: def.displayName,
        description: def.description,
        permissions: [...def.permissions],
        isBuiltIn: true,
      },
      create: {
        key: def.key,
        displayName: def.displayName,
        description: def.description,
        permissions: [...def.permissions],
        isBuiltIn: true,
      },
    });
    roleIdByKey.set(def.key, r.id);
  }

  const adminRoleId = roleIdByKey.get("ADMIN")!;
  const userRoleId = roleIdByKey.get("USER")!;

  const rng = makeRng(20260428);
  const users = buildUsers();

  console.log(`[seed] inserting ${users.length} users…`);

  const emailToId = new Map<string, string>();

  for (const u of users) {
    const created = await prisma.user.create({
      data: {
        email: u.email,
        displayName: u.displayName,
        roleTag: u.roleTag,
        region: u.region,
        status: "ACTIVE",
        // Synthetic users default to USER role. The owner row below
        // overrides for the real account.
        dashboardRoleId: userRoleId,
      },
    });
    emailToId.set(u.email, created.id);
  }

  // 2) Owner row — make sure agoyal@wdtablesystems.com exists with
  //    isOwner=true, ADMIN role, and the title stamped on. Upsert so a
  //    re-seed doesn't blow away role/title changes the live user made
  //    via /settings (though the seed wipes data anyway in dev).
  console.log(`[seed] ensuring owner row for ${OWNER_EMAIL}…`);
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {
      displayName: OWNER_DISPLAY_NAME,
      title: OWNER_TITLE,
      isOwner: true,
      disabled: false,
      dashboardRoleId: adminRoleId,
    },
    create: {
      email: OWNER_EMAIL,
      displayName: OWNER_DISPLAY_NAME,
      title: OWNER_TITLE,
      isOwner: true,
      disabled: false,
      roleTag: "EXEC",
      region: "APAC-AU",
      status: "ACTIVE",
      dashboardRoleId: adminRoleId,
    },
  });
  emailToId.set(OWNER_EMAIL, owner.id);

  // Wire up manager relationships now that all users exist.
  for (const u of users) {
    if (!u.managerEmail) continue;
    const id = emailToId.get(u.email)!;
    const managerId = emailToId.get(u.managerEmail);
    if (managerId) {
      await prisma.user.update({ where: { id }, data: { managerId } });
    }
  }

  // Cursor seat allocation. Scaled to the 30-user prototype, mirroring the
  // §4.6.1 four-sub-tier shape (v2.0+ design, current at v2.3) —
  // Power 17 / Standard 42 / Light 25 / Discovery 36 in the live program.
  // We keep ~17 paid seats out of 30 users so the seat-board renders
  // meaningfully and at least one seat per tier is filled in the demo.
  const seniors = users.filter((u) => u.role === "senior_engineer");
  const mids = users.filter((u) => u.role === "mid_engineer");

  const cursorPower = seniors.slice(0, 3); // 3 — top seniors
  const cursorStandard = [...seniors.slice(3), ...mids.slice(0, 4)]; // ~6
  const cursorLight = mids.slice(4, 8); // 4
  const cursorDiscovery = mids.slice(8, 12); // 4 — evaluation / occasional users

  console.log(
    `[seed] cursor seats: power=${cursorPower.length}, standard=${cursorStandard.length}, light=${cursorLight.length}, discovery=${cursorDiscovery.length}, total=${
      cursorPower.length +
      cursorStandard.length +
      cursorLight.length +
      cursorDiscovery.length
    }`,
  );

  // Codex tiers: 2 Power, 6 Standard, 6 Light, rest Discovery.
  const codexPower = seniors.slice(0, 2);
  const codexStandard = [...seniors.slice(2), ...mids.slice(0, 2)]; // 6
  const codexLight = mids.slice(2, 8); // 6
  const codexDiscoveryEmails = new Set(
    users.map((u) => u.email).filter((e) => {
      return ![...codexPower, ...codexStandard, ...codexLight]
        .map((u) => u.email)
        .includes(e);
    }),
  );

  // Claude.ai: every documentation-heavy user gets a seat (5 total).
  const claudeUsers = users.filter((u) => u.role === "documentation_heavy");

  // M365 Copilot: ~25 users today; engineering users flagged "likely-reclaim".
  const copilotUsers = users.filter((u) => u.role !== "service_account").slice(0, 25);

  console.log("[seed] inserting licenses…");

  for (const u of users) {
    const userId = emailToId.get(u.email)!;
    if (u.role === "service_account") continue; // service accounts skip ChatGPT/Codex licenses

    // ChatGPT — every non-service-account user.
    await prisma.license.create({
      data: {
        userId,
        product: "CHATGPT",
        subTier: "chatgpt_default",
        capUsdMonth: CHATGPT_CAP_USD_MONTH,
        source: "AUTO_PROVISIONED",
      },
    });

    // Codex — assign a sub-tier per user.
    let codexTier = "DISCOVERY";
    let codexCap = CODEX_TIERS.DISCOVERY.capUsdMonth;
    if (codexPower.includes(u)) {
      codexTier = "POWER";
      codexCap = CODEX_TIERS.POWER.capUsdMonth;
    } else if (codexStandard.includes(u)) {
      codexTier = "STANDARD";
      codexCap = CODEX_TIERS.STANDARD.capUsdMonth;
    } else if (codexLight.includes(u)) {
      codexTier = "LIGHT";
      codexCap = CODEX_TIERS.LIGHT.capUsdMonth;
    }
    void codexDiscoveryEmails;

    await prisma.license.create({
      data: {
        userId,
        product: "CODEX",
        subTier: `codex_${codexTier.toLowerCase()}`,
        capUsdMonth: codexCap,
        source: "AUTO_PROVISIONED",
      },
    });
  }

  for (const u of cursorPower) {
    await prisma.license.create({
      data: {
        userId: emailToId.get(u.email)!,
        product: "CURSOR",
        subTier: "cursor_power",
        capUsdMonth: CURSOR_TIERS.POWER.capUsdMonth,
        source: "AUTO_PROVISIONED",
      },
    });
  }
  for (const u of cursorStandard) {
    await prisma.license.create({
      data: {
        userId: emailToId.get(u.email)!,
        product: "CURSOR",
        subTier: "cursor_standard",
        capUsdMonth: CURSOR_TIERS.STANDARD.capUsdMonth,
        source: "AUTO_PROVISIONED",
      },
    });
  }
  for (const u of cursorLight) {
    await prisma.license.create({
      data: {
        userId: emailToId.get(u.email)!,
        product: "CURSOR",
        subTier: "cursor_light",
        capUsdMonth: CURSOR_TIERS.LIGHT.capUsdMonth,
        source: "AUTO_PROVISIONED",
      },
    });
  }
  for (const u of cursorDiscovery) {
    await prisma.license.create({
      data: {
        userId: emailToId.get(u.email)!,
        product: "CURSOR",
        subTier: "cursor_discovery",
        capUsdMonth: CURSOR_TIERS.DISCOVERY.capUsdMonth,
        source: "AUTO_PROVISIONED",
      },
    });
  }

  for (const u of claudeUsers) {
    await prisma.license.create({
      data: {
        userId: emailToId.get(u.email)!,
        product: "CLAUDE_AI",
        subTier: "claude_documentation",
        capUsdMonth: CLAUDE_CAP_USD_MONTH,
        source: "AUTO_PROVISIONED",
      },
    });
  }

  for (const u of copilotUsers) {
    const flag =
      u.role === "senior_engineer" || u.role === "mid_engineer" ? "likely-reclaim" : null;
    await prisma.license.create({
      data: {
        userId: emailToId.get(u.email)!,
        product: "M365_COPILOT",
        subTier: "m365_copilot_default",
        capUsdMonth: null, // seat-priced; no per-user $ cap
        source: "AUTO_PROVISIONED",
        flag,
      },
    });
  }

  // Usage records — per user, ~100-200 across the past 30 days.
  console.log("[seed] generating usage records…");

  const now = new Date();
  const startMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  type UsageInput = {
    userId: string;
    product: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    decision: string;
    region: string;
    ts: Date;
  };
  const allUsage: UsageInput[] = [];

  for (const u of users) {
    if (u.role === "service_account") continue;

    const userId = emailToId.get(u.email)!;
    const region = u.region;

    // Choose a "spend intensity" 0..1 by tier.
    let intensity = 0.4;
    if (cursorPower.includes(u) || codexPower.includes(u)) intensity = 0.95; // hot
    else if (cursorStandard.includes(u) || codexStandard.includes(u)) intensity = 0.65;
    else if (cursorLight.includes(u) || codexLight.includes(u)) intensity = 0.3;
    else if (cursorDiscovery.includes(u)) intensity = 0.12; // low-cap evaluation tier
    else if (u.role === "documentation_heavy") intensity = 0.55;
    else if (u.role === "contractor") intensity = 0.15;

    // Make a couple of users near-idle for the F1/F2 narrative.
    if (u.email.startsWith("hugo.") || u.email.startsWith("xenia.")) intensity = 0.05;

    const records = rngInt(rng, 100, 200);

    for (let i = 0; i < records; i++) {
      const ts = new Date(startMs + Math.floor(rng() * (now.getTime() - startMs)));

      // Distribute usage across products this user has licenses for.
      const products = ["CHATGPT", "CODEX"];
      if (
        cursorPower.includes(u) ||
        cursorStandard.includes(u) ||
        cursorLight.includes(u)
      ) {
        products.push("CURSOR", "CURSOR"); // weight Cursor higher for seat holders
      } else if (cursorDiscovery.includes(u)) {
        products.push("CURSOR"); // single weight — Discovery is low-but-real usage
      }
      if (claudeUsers.includes(u)) products.push("CLAUDE_AI");
      if (copilotUsers.includes(u)) products.push("M365_COPILOT");

      const product = pick(rng, products);

      const model = pickModel(rng, product);

      const baseCost = costForProduct(rng, product, intensity);
      // Macau users blocked on OpenAI products (§3.3 jurisdictional case).
      const blocked = region === "apac-mo" && (product === "CHATGPT" || product === "CODEX");
      const decision = blocked ? "BLOCKED" : rng() < 0.02 ? "PROMPTED" : "ALLOWED";

      allUsage.push({
        userId,
        product,
        model,
        tokensIn: rngInt(rng, 500, 8000),
        tokensOut: rngInt(rng, 200, 3500),
        costUsd: blocked ? 0 : Number(baseCost.toFixed(4)),
        decision,
        region,
        ts,
      });
    }
  }

  // Bulk insert in chunks for speed.
  const CHUNK = 500;
  for (let i = 0; i < allUsage.length; i += CHUNK) {
    await prisma.usageRecord.createMany({ data: allUsage.slice(i, i + CHUNK) });
  }
  console.log(`[seed] inserted ${allUsage.length} usage records.`);

  // Decisions — a curated, realistic-looking set.
  console.log("[seed] inserting program decisions…");

  const justifications: { type: string; subject?: string; j: string; before: object; after: object }[] = [
    {
      type: "TIER_PROMOTION",
      subject: seniors[0]?.email,
      j: "Auto-promotion: 2 consecutive months >50% Codex Standard cap utilisation; manager attestation on file.",
      before: { codex_tier: "STANDARD", cap_usd_month: 1400 },
      after: { codex_tier: "POWER", cap_usd_month: 2500 },
    },
    {
      type: "TIER_DEMOTION",
      subject: mids[10]?.email,
      j: "Auto-demotion: <10% of Codex Light cap consumed for 3 consecutive months.",
      before: { codex_tier: "LIGHT", cap_usd_month: 1000 },
      after: { codex_tier: "DISCOVERY", cap_usd_month: 75 },
    },
    {
      type: "RECLAMATION",
      subject: "hugo.liu@wdts.com",
      j: "Cursor seat reclaimed at 45 days of zero activity per §4.6.4. Seat returned to waitlist.",
      before: { cursor_seat: "STANDARD" },
      after: { cursor_seat: null },
    },
    {
      type: "EXCEPTION_GRANT",
      subject: claudeUsers[1]?.email,
      j: "30-day budget elevation to $200/mo Claude.ai cap to support Q3 regulatory submission. Auto-revoke on day 30.",
      before: { claude_cap_usd_month: 100 },
      after: { claude_cap_usd_month: 200, ttl_days: 30 },
    },
    {
      type: "METHODOLOGY_CHANGE",
      j: "Cursor selection methodology Appendix G v1.2 ratified by Steering: increase weighting on agent-mode adoption from 25% to 40%.",
      before: { agent_mode_weight: 0.25 },
      after: { agent_mode_weight: 0.4 },
    },
    {
      type: "CAP_ADJUSTMENT",
      j: "Codex Discovery per-user cap held at $75/mo for FY26 H1 (no increase) per Steering review.",
      before: { discovery_cap: 75 },
      after: { discovery_cap: 75, decision_window: "FY26-H1" },
    },
    {
      type: "CURSOR_SEAT_GRANT",
      subject: mids[3]?.email,
      j: "Cursor Standard seat granted from waitlist position #1 following hugo.liu reclamation.",
      before: { cursor_seat: null },
      after: { cursor_seat: "STANDARD" },
    },
    {
      type: "EXCEPTION_GRANT",
      subject: users.find((u) => u.region === "apac-mo")?.email,
      j: "Jurisdictional exception (§3.3): user temporarily pair-routed via us-east colleague for ChatGPT access pending vendor coverage update.",
      before: { jurisdictional_status: "BLOCKED" },
      after: { jurisdictional_status: "PAIR_ROUTED", ttl_days: 14 },
    },
    {
      type: "RECLAMATION",
      subject: "xenia.holland@wdts.com",
      j: "Cursor seat 30-day notice issued; re-activation window ends in 5 business days.",
      before: { cursor_seat: "LIGHT", state: "ACTIVE" },
      after: { cursor_seat: "LIGHT", state: "NOTIFIED" },
    },
    {
      type: "CAP_ADJUSTMENT",
      j: "Program-level circuit breaker fired at 92% of $150K combined ChatGPT+Codex monthly cap; FinOps dashboard banner enabled.",
      before: { circuit_breaker: "GREEN" },
      after: { circuit_breaker: "AMBER", threshold_pct: 0.92 },
    },
  ];

  const sixtyDaysAgoMs = now.getTime() - 60 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < justifications.length; i++) {
    const d = justifications[i]!;
    const ts = new Date(
      sixtyDaysAgoMs + (i / Math.max(1, justifications.length - 1)) * (now.getTime() - sixtyDaysAgoMs),
    );
    const subjectId = d.subject ? emailToId.get(d.subject) : undefined;
    await prisma.decision.create({
      data: {
        type: d.type,
        subjectUserId: subjectId,
        beforeState: JSON.stringify(d.before),
        afterState: JSON.stringify(d.after),
        actorEmail: i % 2 === 0 ? "finops@wdts.com" : "head-of-engineering@wdts.com",
        justification: d.j,
        evidenceLink: i % 3 === 0 ? "https://example.wdts.com/policies/pull/" + (1000 + i) : null,
        ts,
      },
    });
  }

  console.log(`[seed] decisions: ${justifications.length}`);
  console.log("[seed] done.");
}

function pickModel(rng: () => number, product: string): string {
  switch (product) {
    case "CURSOR":
      return pick(rng, ["claude-sonnet-4.5", "gpt-4.1", "gpt-4o-mini", "o1-mini"]);
    case "CODEX":
      return pick(rng, ["codex-flagship", "codex-mini", "codex-fast"]);
    case "CHATGPT":
      return pick(rng, ["gpt-4o", "gpt-4o-mini", "o1-mini"]);
    case "CLAUDE_AI":
      return pick(rng, ["claude-opus-4", "claude-sonnet-4.5"]);
    case "M365_COPILOT":
      return pick(rng, ["copilot-default"]);
    default:
      return "unknown";
  }
}

function costForProduct(rng: () => number, product: string, intensity: number) {
  // Returns a per-request cost in USD. Larger products cost more on average.
  const base = (() => {
    switch (product) {
      case "CURSOR":
        return rngBetween(rng, 0.5, 6);
      case "CODEX":
        return rngBetween(rng, 0.2, 4);
      case "CHATGPT":
        return rngBetween(rng, 0.02, 0.4);
      case "CLAUDE_AI":
        return rngBetween(rng, 0.3, 2.5);
      case "M365_COPILOT":
        return 0; // seat-priced; no per-request cost
      default:
        return 0.1;
    }
  })();
  return base * intensity;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
