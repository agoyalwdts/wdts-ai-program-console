/**
 * F10 chargeback data loader — vendor spend merge, manager or cost-centre grouping.
 */

import type { PrismaClient } from "@prisma/client";
import { getGatewayClient } from "@/lib/integrations";
import { costCentreLabel } from "@/lib/finops/cost-centres";
import { PRODUCTS, type ProductKey } from "@/lib/program";
import {
  aggregateChargebackSpendByUserId,
  emptyProductSpend,
  totalSpendForUser,
  type ChargebackSpendMeta,
  type UserSpendByProduct,
} from "./aggregate-user-spend";

export type ChargebackGroupBy = "manager" | "cost-centre";

export type ChargebackPeriod = {
  start: Date;
  end: Date;
  label: string;
  isCurrent: boolean;
};

export type ChargebackMember = {
  userId: string;
  email: string;
  displayName: string;
  region: string;
  roleTag: string | null;
  costCentre: string | null;
  managerDisplayName: string | null;
  spendByProduct: UserSpendByProduct;
  totalSpend: number;
  budgetByProduct: Record<ProductKey, number>;
  totalBudget: number;
};

export type ChargebackTeam = {
  key: string;
  headerId: string | null;
  headerName: string;
  headerSubtitle: string | null;
  members: ChargebackMember[];
  totalSpend: number;
  totalBudget: number;
  spendByProduct: Record<ProductKey, number>;
  budgetByProduct: Record<ProductKey, number>;
};

export type ChargebackData = {
  period: ChargebackPeriod;
  groupBy: ChargebackGroupBy;
  teamRows: ChargebackTeam[];
  programTotal: number;
  programBudget: number;
  programOverage: number;
  spendMeta: ChargebackSpendMeta;
};

function parseMonth(spec: string | undefined): ChargebackPeriod {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (spec) {
    const m = spec.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]) - 1;
    }
  }
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const cappedEnd = end.getTime() > now.getTime() ? now : end;
  const label = start.toLocaleString("en-US", { month: "long", year: "numeric" });
  const isCurrent =
    start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear();
  return { start, end: cappedEnd, label, isCurrent };
}

function emptyProductMap(): Record<ProductKey, number> {
  const m = {} as Record<ProductKey, number>;
  for (const p of PRODUCTS) m[p.key] = 0;
  return m;
}

function parseGroupBy(raw: string | undefined): ChargebackGroupBy {
  return raw === "cost-centre" ? "cost-centre" : "manager";
}

export async function loadChargebackData(
  prisma: PrismaClient,
  args: { month?: string; groupBy?: string },
): Promise<ChargebackData> {
  const period = parseMonth(args.month);
  const groupBy = parseGroupBy(args.groupBy);

  const [users, licenses, gatewayAggs] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        region: true,
        roleTag: true,
        costCentre: true,
        managerId: true,
        manager: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.license.findMany({
      select: { userId: true, product: true, capUsdMonth: true },
    }),
    getGatewayClient().aggregateByUser({
      periodStart: period.start,
      periodEnd: period.end,
    }),
  ]);

  const emailToUserId = new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id]));

  const { spendByUserId, meta } = await aggregateChargebackSpendByUserId({
    prisma,
    gatewayAggs,
    emailToUserId,
    periodStart: period.start,
    periodEnd: period.end,
  });

  const budgetByUser = new Map<string, Record<ProductKey, number>>();
  for (const l of licenses) {
    const m = budgetByUser.get(l.userId) ?? emptyProductMap();
    m[l.product as ProductKey] = (m[l.product as ProductKey] ?? 0) + (l.capUsdMonth ?? 0);
    budgetByUser.set(l.userId, m);
  }

  const teams = new Map<string, ChargebackTeam>();

  function getOrCreateNoManagerTeam(): ChargebackTeam {
    let team = teams.get("no-manager");
    if (!team) {
      team = {
        key: "no-manager",
        headerId: null,
        headerName: "Unmanaged / top-level",
        headerSubtitle: null,
        members: [],
        totalSpend: 0,
        totalBudget: 0,
        spendByProduct: emptyProductMap(),
        budgetByProduct: emptyProductMap(),
      };
      teams.set("no-manager", team);
    }
    return team;
  }

  function getOrCreateUnassignedCostCentreTeam(): ChargebackTeam {
    let team = teams.get("unassigned");
    if (!team) {
      team = {
        key: "unassigned",
        headerId: null,
        headerName: costCentreLabel(null),
        headerSubtitle: "No cost-centre mapped",
        members: [],
        totalSpend: 0,
        totalBudget: 0,
        spendByProduct: emptyProductMap(),
        budgetByProduct: emptyProductMap(),
      };
      teams.set("unassigned", team);
    }
    return team;
  }

  function teamForUser(u: (typeof users)[number]): ChargebackTeam {
    if (groupBy === "cost-centre") {
      if (!u.costCentre) return getOrCreateUnassignedCostCentreTeam();
      const key = `cost-centre:${u.costCentre}`;
      let team = teams.get(key);
      if (!team) {
        team = {
          key,
          headerId: null,
          headerName: costCentreLabel(u.costCentre),
          headerSubtitle: u.costCentre,
          members: [],
          totalSpend: 0,
          totalBudget: 0,
          spendByProduct: emptyProductMap(),
          budgetByProduct: emptyProductMap(),
        };
        teams.set(key, team);
      }
      return team;
    }

    if (u.manager) {
      const key = `manager:${u.manager.id}`;
      let team = teams.get(key);
      if (!team) {
        team = {
          key,
          headerId: u.manager.id,
          headerName: u.manager.displayName,
          headerSubtitle: u.manager.email,
          members: [],
          totalSpend: 0,
          totalBudget: 0,
          spendByProduct: emptyProductMap(),
          budgetByProduct: emptyProductMap(),
        };
        teams.set(key, team);
      }
      return team;
    }
    return getOrCreateNoManagerTeam();
  }

  for (const u of users) {
    const spend = spendByUserId.get(u.id) ?? emptyProductSpend();
    const budget = budgetByUser.get(u.id) ?? emptyProductMap();
    const totalSpend = totalSpendForUser(spend);
    const totalBudget = Object.values(budget).reduce((s, v) => s + v, 0);

    if (totalSpend <= 0 && totalBudget <= 0) continue;

    const team = teamForUser(u);
    team.members.push({
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      region: u.region,
      roleTag: u.roleTag,
      costCentre: u.costCentre,
      managerDisplayName: u.manager?.displayName ?? null,
      spendByProduct: spend,
      totalSpend,
      budgetByProduct: budget,
      totalBudget,
    });
    team.totalSpend += totalSpend;
    team.totalBudget += totalBudget;
    for (const p of PRODUCTS) {
      team.spendByProduct[p.key] += spend[p.key];
      team.budgetByProduct[p.key] += budget[p.key];
    }
  }

  const teamRows = Array.from(teams.values())
    .filter((t) => t.members.length > 0)
    .sort((a, b) => b.totalSpend - a.totalSpend);

  for (const t of teamRows) {
    t.members.sort((a, b) => b.totalSpend - a.totalSpend);
  }

  const programTotal = teamRows.reduce((s, t) => s + t.totalSpend, 0);
  const programBudget = teamRows.reduce((s, t) => s + t.totalBudget, 0);
  const programOverage = teamRows.reduce(
    (s, t) => s + Math.max(0, t.totalSpend - t.totalBudget),
    0,
  );

  return {
    period,
    groupBy,
    teamRows,
    programTotal,
    programBudget,
    programOverage,
    spendMeta: meta,
  };
}
