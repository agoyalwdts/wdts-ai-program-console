-- Historical correction: manual ChatGPT/Codex admin exports were stored as
-- credits in VendorDailySpend.spendUsd. Convert legacy rows to USD using
-- contract rate $0.04/credit.
UPDATE "VendorDailySpend"
SET "spendUsd" = "spendUsd" * 0.04
WHERE "vendor" IN ('MANUAL_CHATGPT_USERS_CSV', 'MANUAL_CODEX_ADMIN_EXPORT');
