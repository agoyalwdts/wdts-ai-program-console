/**
 * Print F1 Actual YTD product breakdown (same logic as /health).
 *
 * Usage:
 *   npx tsx scripts/print-ytd-breakdown.ts
 *   DATABASE_URL='postgresql://...' npx tsx scripts/print-ytd-breakdown.ts
 */

import { prisma } from "@/lib/prisma";
import {
  budgetMonthMultiplierForWindow,
  calendarYearToDateWindow,
  effectiveCursorYtdWindow,
  loadProgramYtdObservedSpendUsd,
  programPlanningYtdUsdForActuals,
} from "@/lib/f1-program-observed-spend";
import {
  MONTHLY_BUDGET_USD,
  OPENAI_COMBINED_MONTHLY_PLANNING_USD,
  PRODUCTS,
  YTD_ACTUALS_EXCLUDED_PRODUCTS,
  cursorProgramStartDate,
} from "@/lib/program";
import { formatUsd } from "@/lib/utils";

function countedYtdUsd(args: {
  key: (typeof PRODUCTS)[number]["key"];
  rawUsd: number;
  budgetMonthMultiplier: number;
}): number | null {
  if (YTD_ACTUALS_EXCLUDED_PRODUCTS.includes(args.key)) return null;
  if (args.key === "M365_COPILOT") {
    return MONTHLY_BUDGET_USD.M365_COPILOT * args.budgetMonthMultiplier;
  }
  return args.rawUsd;
}

async function main(): Promise<void> {
  const now = new Date();
  const window = calendarYearToDateWindow(now);
  const ytd = await loadProgramYtdObservedSpendUsd(prisma, now);
  const plan = programPlanningYtdUsdForActuals(now);
  const cursorWindow = effectiveCursorYtdWindow({
    ytdPeriodStart: window.periodStart,
    ytdPeriodEnd: window.periodEnd,
  });
  const openAiPlan =
    OPENAI_COMBINED_MONTHLY_PLANNING_USD * ytd.budgetMonthMultiplier;
  const m365Plan = MONTHLY_BUDGET_USD.M365_COPILOT * ytd.budgetMonthMultiplier;
  const cursorPlan = cursorWindow
    ? MONTHLY_BUDGET_USD.CURSOR *
      budgetMonthMultiplierForWindow(cursorWindow.periodStart, cursorWindow.periodEnd)
    : 0;

  console.log("F1 Actual YTD breakdown");
  console.log(`As of: ${now.toISOString()}`);
  console.log(`Window: ${ytd.rangeDescription}`);
  console.log(`Day multiplier (Jan 1 → now): ${ytd.budgetMonthMultiplier.toFixed(4)}`);
  if (cursorWindow) {
    console.log(
      `Cursor slice: ${cursorWindow.periodStart.toISOString().slice(0, 10)} → ${cursorWindow.periodEnd.toISOString().slice(0, 10)} (go-live ${cursorProgramStartDate().toISOString().slice(0, 10)})`,
    );
  }
  console.log("");

  console.log("Product          │ Counted in YTD │ Mirror / source USD │ Prorated plan");
  console.log("─────────────────┼────────────────┼─────────────────────┼──────────────");

  for (const { key, label } of PRODUCTS) {
    const raw = ytd.byProduct.get(key) ?? 0;
    const counted = countedYtdUsd({
      key,
      rawUsd: raw,
      budgetMonthMultiplier: ytd.budgetMonthMultiplier,
    });
    const planLine =
      key === "CLAUDE_AI"
        ? "—"
        : key === "CURSOR"
          ? formatUsd(cursorPlan, { decimals: 0 })
          : key === "M365_COPILOT"
            ? formatUsd(m365Plan, { decimals: 0 })
            : key === "CHATGPT" || key === "CODEX"
              ? "—"
              : "—";

    const countedStr =
      counted == null ? "excluded" : formatUsd(counted, { decimals: 0 });
    const rawNote =
      key === "M365_COPILOT"
        ? `commit (not usage)`
        : formatUsd(raw, { decimals: 0 });

    console.log(
      `${label.padEnd(16)} │ ${countedStr.padStart(14)} │ ${rawNote.padStart(19)} │ ${planLine.padStart(12)}`,
    );
  }

  const openAiRaw =
    (ytd.byProduct.get("CHATGPT") ?? 0) + (ytd.byProduct.get("CODEX") ?? 0);
  console.log("─────────────────┼────────────────┼─────────────────────┼──────────────");
  console.log(
    `${"OpenAI combined".padEnd(16)} │ ${formatUsd(openAiRaw, { decimals: 0 }).padStart(14)} │ ${"(ChatGPT + Codex)".padStart(19)} │ ${formatUsd(openAiPlan, { decimals: 0 }).padStart(12)}`,
  );
  console.log("─────────────────┼────────────────┼─────────────────────┼──────────────");
  console.log(
    `${"TOTAL".padEnd(16)} │ ${formatUsd(ytd.totalUsd, { decimals: 0 }).padStart(14)} │ ${"".padStart(19)} │ ${formatUsd(plan, { decimals: 0 }).padStart(12)}`,
  );
  console.log(
    `\nVariance (actual − plan): ${formatUsd(ytd.totalUsd - plan, { decimals: 0 })}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
