import type { ManualVendorSnapshotDTO } from "./manual-vendor-snapshots";

/** Prefer the first matching snapshot kind (compliance sync before manual CSV). */
export function findSnapshotPreferring(
  snapshots: ManualVendorSnapshotDTO[],
  ...kinds: string[]
): ManualVendorSnapshotDTO | undefined {
  for (const kind of kinds) {
    const hit = snapshots.find((s) => s.kind === kind);
    if (hit) return hit;
  }
  return undefined;
}

export function snapshotSourceLabel(kind: string): string {
  if (kind.endsWith("_CSV")) return "manual CSV import";
  if (kind === "CHATGPT_USER_ANALYTICS") return "Workspace Analytics API sync";
  if (kind === "CHATGPT_PROJECT_ANALYTICS") return "Workspace Analytics API sync";
  if (kind === "CHATGPT_GPT_ANALYTICS") return "Workspace Analytics API sync";
  if (kind === "CHATGPT_SURVEY_ANALYTICS") return "Workspace Analytics API sync";
  if (kind === "UNIFIED_CREDITS_COSTS") return "Unified Credits COSTS sync";
  return kind;
}
