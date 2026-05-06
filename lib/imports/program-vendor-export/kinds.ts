export const PROGRAM_VENDOR_EXPORT_KINDS = [
  "CHATGPT_USERS_CSV",
  "CHATGPT_GPTS_CSV",
  "CHATGPT_PROJECTS_CSV",
  "CHATGPT_IMPACT_SURVEY_CSV",
  "CODEX_WORKSPACE_JSON",
  "CODEX_SESSIONS_JSON",
  "CODEX_CODE_REVIEW_JSON",
  "CURSOR_ANALYTICS_TEAM_CSV",
] as const;

export type ProgramVendorExportKind = (typeof PROGRAM_VENDOR_EXPORT_KINDS)[number];

export function isProgramVendorExportKind(s: string): s is ProgramVendorExportKind {
  return (PROGRAM_VENDOR_EXPORT_KINDS as readonly string[]).includes(s);
}
