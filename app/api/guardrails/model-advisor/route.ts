import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { evaluateModelAdvisor, type AdvisorInput } from "@/lib/guardrails/advisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await requireUser();

  let body: Partial<AdvisorInput>;
  try {
    body = (await req.json()) as Partial<AdvisorInput>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (!body.product || !body.selectedModel) {
    return NextResponse.json(
      { ok: false, error: "expected { product, selectedModel, ... }" },
      { status: 400 },
    );
  }

  const outcome = evaluateModelAdvisor({
    product: body.product,
    selectedModel: body.selectedModel,
    tokensIn: body.tokensIn,
    tokensOut: body.tokensOut,
    maxMode: body.maxMode,
    explicitComplexity: body.explicitComplexity,
  });

  return NextResponse.json({ ok: true, outcome });
}
