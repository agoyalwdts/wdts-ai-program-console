import {
  PrismaClient,
  Product,
  UsageDecision,
  DecisionType,
  ExceptionType,
  ExceptionStatus,
  ReclamationTrigger,
  ReclamationAction,
  ReclamationState,
} from "@prisma/client";
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
import { seedCostCentreForEmail } from "../lib/finops/cost-centres";

const prisma = new PrismaClient();

const OWNER_EMAIL = "agoyal@wdtablesystems.com";
const OWNER_DISPLAY_NAME = "Anuj Goyal";
const OWNER_TITLE = "Chief Technology Officer · Head of AI Task Force";

async function main() {
  console.log("[seed] purging existing rows…");
  // Wipe order matters — child tables first so FK constraints don't trip.
  // ExceptionRequest + ReclamationEvent reference Decision and User; both
  // have to clear before Decision and User. BudgetSnapshot and
  // FrictionBudgetMetric have no FKs and are safe to clear anywhere.
  await prisma.exceptionRequest.deleteMany();
  await prisma.reclamationEvent.deleteMany();
  await prisma.budgetSnapshot.deleteMany();
  await prisma.frictionBudgetMetric.deleteMany();
  await prisma.cursorUsagePrudenceAlert.deleteMany();
  await prisma.vendorDailySpend.deleteMany();
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
        costCentre: seedCostCentreForEmail(u.email),
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
    product: Product;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    decision: UsageDecision;
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
      const products: Product[] = [Product.CHATGPT, Product.CODEX];
      if (
        cursorPower.includes(u) ||
        cursorStandard.includes(u) ||
        cursorLight.includes(u)
      ) {
        products.push(Product.CURSOR, Product.CURSOR); // weight Cursor higher for seat holders
      } else if (cursorDiscovery.includes(u)) {
        products.push(Product.CURSOR); // single weight — Discovery is low-but-real usage
      }
      if (claudeUsers.includes(u)) products.push(Product.CLAUDE_AI);
      if (copilotUsers.includes(u)) products.push(Product.M365_COPILOT);

      const product = pick(rng, products);

      const model = pickModel(rng, product);

      const baseCost = costForProduct(rng, product, intensity);
      // Macau users blocked on OpenAI products (§3.3 jurisdictional case).
      const blocked =
        region === "apac-mo" &&
        (product === Product.CHATGPT || product === Product.CODEX);
      const decision: UsageDecision = blocked
        ? UsageDecision.BLOCKED
        : rng() < 0.02
          ? UsageDecision.PROMPTED
          : UsageDecision.ALLOWED;

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

  const justifications: {
    type: DecisionType;
    subject?: string;
    j: string;
    before: object;
    after: object;
  }[] = [
    {
      type: DecisionType.TIER_PROMOTION,
      subject: seniors[0]?.email,
      j: "Auto-promotion: 2 consecutive months >50% Codex Standard cap utilisation; manager attestation on file.",
      before: { codex_tier: "STANDARD", cap_usd_month: 1400 },
      after: { codex_tier: "POWER", cap_usd_month: 2500 },
    },
    {
      type: DecisionType.TIER_DEMOTION,
      subject: mids[10]?.email,
      j: "Auto-demotion: <10% of Codex Light cap consumed for 3 consecutive months.",
      before: { codex_tier: "LIGHT", cap_usd_month: 1000 },
      after: { codex_tier: "DISCOVERY", cap_usd_month: 75 },
    },
    {
      type: DecisionType.RECLAMATION,
      subject: "hugo.liu@wdts.com",
      j: "Cursor seat reclaimed at 45 days of zero activity per §4.6.4. Seat returned to waitlist.",
      before: { cursor_seat: "STANDARD" },
      after: { cursor_seat: null },
    },
    {
      type: DecisionType.EXCEPTION_GRANT,
      subject: claudeUsers[1]?.email,
      j: "30-day budget elevation to $200/mo Claude.ai cap to support Q3 regulatory submission. Auto-revoke on day 30.",
      before: { claude_cap_usd_month: 100 },
      after: { claude_cap_usd_month: 200, ttl_days: 30 },
    },
    {
      type: DecisionType.METHODOLOGY_CHANGE,
      j: "Cursor selection methodology Appendix G v1.2 ratified by Steering: increase weighting on agent-mode adoption from 25% to 40%.",
      before: { agent_mode_weight: 0.25 },
      after: { agent_mode_weight: 0.4 },
    },
    {
      type: DecisionType.CAP_ADJUSTMENT,
      j: "Codex Discovery per-user cap held at $75/mo for FY26 H1 (no increase) per Steering review.",
      before: { discovery_cap: 75 },
      after: { discovery_cap: 75, decision_window: "FY26-H1" },
    },
    {
      type: DecisionType.CURSOR_SEAT_GRANT,
      subject: mids[3]?.email,
      j: "Cursor Standard seat granted from waitlist position #1 following hugo.liu reclamation.",
      before: { cursor_seat: null },
      after: { cursor_seat: "STANDARD" },
    },
    {
      type: DecisionType.EXCEPTION_GRANT,
      subject: users.find((u) => u.region === "apac-mo")?.email,
      j: "Jurisdictional exception (§3.3): user temporarily pair-routed via us-east colleague for ChatGPT access pending vendor coverage update.",
      before: { jurisdictional_status: "BLOCKED" },
      after: { jurisdictional_status: "PAIR_ROUTED", ttl_days: 14 },
    },
    {
      type: DecisionType.RECLAMATION,
      subject: "xenia.holland@wdts.com",
      j: "Cursor seat 30-day notice issued; re-activation window ends in 5 business days.",
      before: { cursor_seat: "LIGHT", state: "ACTIVE" },
      after: { cursor_seat: "LIGHT", state: "NOTIFIED" },
    },
    {
      type: DecisionType.CAP_ADJUSTMENT,
      j: "Program-level circuit breaker fired at 92% of combined ChatGPT+Codex monthly cap; FinOps dashboard banner enabled.",
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

  // ExceptionRequest — three rows covering distinct lifecycle states so
  // F8 / DB-integration tests can exercise the state machine.
  // We pick subjects from the deterministic mids/seniors arrays so the
  // seed doesn't break when buildUsers() shuffles names.
  console.log("[seed] inserting exception requests…");
  const idleMid = mids[10] ?? mids[0];
  const recentMid = mids[11] ?? mids[1];
  const claudeUser = claudeUsers[0]?.email
    ? emailToId.get(claudeUsers[0].email)
    : undefined;
  const macauUser = users.find((u) => u.region === "apac-mo")?.email
    ? emailToId.get(users.find((u) => u.region === "apac-mo")!.email)
    : undefined;
  const idleMidId = idleMid ? emailToId.get(idleMid.email) : undefined;
  const recentMidId = recentMid ? emailToId.get(recentMid.email) : undefined;

  if (claudeUser) {
    await prisma.exceptionRequest.create({
      data: {
        subjectUserId: claudeUser,
        type: ExceptionType.BUDGET_ELEVATION,
        status: ExceptionStatus.APPROVED,
        effectChange: JSON.stringify({ capUsdMonth: 200 }),
        justification:
          "30-day budget elevation to $200/mo Claude.ai cap to support Q3 regulatory submission.",
        requestedByEmail: "head-of-compliance@wdts.com",
        requestedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
        attestedByEmail: "head-of-engineering@wdts.com",
        attestedAt: new Date(now.getTime() - 19 * 24 * 60 * 60 * 1000),
        reviewedByEmail: "finops@wdts.com",
        reviewedAt: new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000),
        approvedAt: new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000),
        ttlDays: 30,
        expiresAt: new Date(now.getTime() + 12 * 24 * 60 * 60 * 1000),
      },
    });
  }
  if (macauUser) {
    await prisma.exceptionRequest.create({
      data: {
        subjectUserId: macauUser,
        type: ExceptionType.JURISDICTIONAL,
        status: ExceptionStatus.UNDER_REVIEW,
        effectChange: JSON.stringify({ jurisdiction: "PAIR_ROUTED" }),
        justification:
          "Macau jurisdictional carve-out: temporarily pair-route via us-east colleague for ChatGPT access pending vendor coverage update.",
        requestedByEmail: "macau-region-lead@wdts.com",
        requestedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        attestedByEmail: "head-of-engineering@wdts.com",
        attestedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        ttlDays: 14,
      },
    });
  }
  if (recentMidId) {
    await prisma.exceptionRequest.create({
      data: {
        subjectUserId: recentMidId,
        type: ExceptionType.TIER_OVERRIDE,
        status: ExceptionStatus.SUBMITTED,
        effectChange: JSON.stringify({ cursorTier: "STANDARD" }),
        justification:
          "Pinning to Standard during onboarding ramp; auto-tier rules would put this user on Discovery.",
        requestedByEmail: "manager@wdts.com",
        requestedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
    });
  }

  // ReclamationEvent — two rows: one in active dispute window, one
  // resolved-reclaimed (so F4 dispute UI has both shapes to render).
  console.log("[seed] inserting reclamation events…");
  if (idleMidId) {
    await prisma.reclamationEvent.create({
      data: {
        subjectUserId: idleMidId,
        trigger: ReclamationTrigger.IDLE,
        action: ReclamationAction.RECLAIM,
        state: ReclamationState.RESOLVED_RECLAIMED,
        triggeredAt: new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000),
        notifiedAt: new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000),
        disputeWindowEndsAt: new Date(now.getTime() - 43 * 24 * 60 * 60 * 1000),
        resolvedAt: new Date(now.getTime() - 43 * 24 * 60 * 60 * 1000),
        resolvedByEmail: "finops@wdts.com",
        justification: "45 days of zero Cursor activity per §4.6.4.",
      },
    });
  }
  if (recentMidId) {
    const fiveBizDays = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    await prisma.reclamationEvent.create({
      data: {
        subjectUserId: recentMidId,
        trigger: ReclamationTrigger.IDLE,
        action: ReclamationAction.NOTIFY,
        state: ReclamationState.NOTIFIED,
        triggeredAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        notifiedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        disputeWindowEndsAt: fiveBizDays,
        justification: "30 days of zero activity; 5-business-day dispute window opened.",
      },
    });
  }

  // BudgetSnapshot — one row per (product, sub-tier) for the current and
  // previous calendar months. F1 trend cards read from this once the
  // materialisation job lands; for v0.3 we just seed deterministic shapes.
  console.log("[seed] inserting budget snapshots…");
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(monthStart.getTime() - 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  type SnapshotInput = {
    product: Product;
    subTier: string;
    totalUsd: number;
    requestCount: number;
    userCount: number;
    capUsdMonth: number | null;
  };
  const snaps: SnapshotInput[] = [
    { product: Product.CURSOR, subTier: "cursor_power", totalUsd: 4_120, requestCount: 2_400, userCount: 3, capUsdMonth: 1_500 },
    { product: Product.CURSOR, subTier: "cursor_standard", totalUsd: 2_840, requestCount: 1_800, userCount: 6, capUsdMonth: 800 },
    { product: Product.CURSOR, subTier: "cursor_light", totalUsd: 920, requestCount: 580, userCount: 4, capUsdMonth: 300 },
    { product: Product.CURSOR, subTier: "cursor_discovery", totalUsd: 84, requestCount: 120, userCount: 4, capUsdMonth: 50 },
    { product: Product.CODEX, subTier: "codex_power", totalUsd: 4_700, requestCount: 3_100, userCount: 2, capUsdMonth: 2_500 },
    { product: Product.CODEX, subTier: "codex_standard", totalUsd: 6_320, requestCount: 4_800, userCount: 6, capUsdMonth: 1_400 },
    { product: Product.CHATGPT, subTier: "chatgpt_default", totalUsd: 412, requestCount: 12_400, userCount: 28, capUsdMonth: 50 },
    { product: Product.CLAUDE_AI, subTier: "claude_documentation", totalUsd: 245, requestCount: 320, userCount: 5, capUsdMonth: 100 },
    { product: Product.M365_COPILOT, subTier: "m365_copilot_default", totalUsd: 0, requestCount: 11_800, userCount: 25, capUsdMonth: null },
  ];
  for (const s of snaps) {
    for (const period of [{ start: prevMonthStart, end: prevMonthEnd, scale: 0.92 }, { start: monthStart, end: monthEnd, scale: 1.0 }]) {
      const total = Math.round(s.totalUsd * period.scale * 100) / 100;
      await prisma.budgetSnapshot.create({
        data: {
          product: s.product,
          subTier: s.subTier,
          periodStart: period.start,
          periodEnd: period.end,
          totalUsd: total,
          requestCount: Math.round(s.requestCount * period.scale),
          userCount: s.userCount,
          capUsdMonth: s.capUsdMonth,
          pctOfCap: s.capUsdMonth ? total / (s.capUsdMonth * s.userCount) : null,
        },
      });
    }
  }

  // FrictionBudgetMetric — one weekly row per product + one cross-product
  // aggregate for the last 4 weeks. Lets F11 render a plausible trend
  // without the materialisation job in place yet.
  console.log("[seed] inserting friction-budget metrics…");
  const productsForMetrics: (Product | null)[] = [null, ...Object.values(Product)];
  for (let w = 4; w >= 1; w--) {
    const weekStart = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    for (const p of productsForMetrics) {
      const totalRequests = rngInt(rng, 800, 4_000);
      const blocked = Math.round(totalRequests * rngBetween(rng, 0.005, 0.04));
      const downgraded = Math.round(totalRequests * rngBetween(rng, 0.0, 0.02));
      const prompted = Math.round(totalRequests * rngBetween(rng, 0.005, 0.03));
      const allowed = totalRequests - blocked - downgraded - prompted;
      const frictionRate = (blocked + downgraded) / totalRequests;
      const budgetCeiling = 0.05;
      await prisma.frictionBudgetMetric.create({
        data: {
          periodStart: weekStart,
          periodEnd: weekEnd,
          product: p ?? null,
          totalRequests,
          allowed,
          prompted,
          blocked,
          downgraded,
          frictionRate,
          budgetCeiling,
          pctOfBudget: frictionRate / budgetCeiling,
        },
      });
    }
  }

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
