import type { Prisma } from "@prisma/client";
import type { ProductKey } from "./day-one-defaults";

export type GuardrailCandidate = {
  occurredAt: Date;
  category: string;
  severity: string;
  ruleCode: string;
  title: string;
  rationale: string;
  recommendation: string | null;
  environment: string | null;
  product: ProductKey | null;
  userEmail: string | null;
  model: string | null;
  source: string;
  context: Prisma.InputJsonValue;
  dedupeKey: string;
};
