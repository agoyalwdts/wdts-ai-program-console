/** Upserted into VendorDailySpend when a ChatGPT users CSV is imported. */
export const MANUAL_CHATGPT_USERS_CSV_VENDOR_KEY = "MANUAL_CHATGPT_USERS_CSV";

/**
 * Upserted into VendorDailySpend from Codex workspace JSON or, if absent,
 * aggregated Codex sessions JSON (same key so later imports replace cleanly).
 */
export const MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY = "MANUAL_CODEX_ADMIN_EXPORT";
