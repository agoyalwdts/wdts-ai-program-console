import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function toCsvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "ALL";
  const since = url.searchParams.get("since");

  const where: Record<string, unknown> = {};
  if (type !== "ALL") where.type = type;
  if (since) where.ts = { gte: new Date(since) };

  const decisions = await prisma.decision.findMany({
    where,
    orderBy: { ts: "desc" },
    include: { subject: { select: { email: true, displayName: true } } },
  });

  const header = [
    "ts",
    "type",
    "subject_email",
    "subject_name",
    "actor_email",
    "before_state",
    "after_state",
    "justification",
    "evidence_link",
  ].join(",");

  const rows = decisions.map((d) =>
    [
      d.ts.toISOString(),
      d.type,
      d.subject?.email ?? "",
      d.subject?.displayName ?? "",
      d.actorEmail,
      d.beforeState,
      d.afterState,
      d.justification,
      d.evidenceLink ?? "",
    ]
      .map(toCsvCell)
      .join(","),
  );

  const body = [header, ...rows].join("\n");
  const filename = `wdts-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
