# Production integration blockers (checklist)

Condensed from **`AGENTS.md` §13** — use this as a human run-down before calling
a surface “live”. Not all rows apply to every milestone.

## Identity & auth

- [ ] Production Entra app registration, admin consent, Key Vault secrets wired.
- [ ] **`CRON_SHARED_SECRET`** in App Service + matching GitHub secret for scheduled jobs.
- [ ] Optional: GitHub **environments** / required reviewers for deploy + cron workflows.

## Gateway mirror (usage analytics path)

- [ ] **`USAGE_INGEST_HMAC_SECRET`** set; forwarder or pilot script posting to `/api/webhooks/usage-ingest` (or LiteLLM path B).
- [ ] **`INTEGRATION_GATEWAY=real`** when mirror is trusted for reads.
- [ ] **`DASHBOARD_PUBLIC_BASE_URL`** (optional) for operator-visible webhook URLs in Settings.

## Cursor

- [ ] SCIM / admin token story agreed; **`CURSOR_SCIM_BASE_URL`**, **`CURSOR_ADMIN_TOKEN`** (or SCIM equivalent) when taking seats live.
- [ ] Team Admin usage: **`CURSOR_TEAM_ADMIN_API_KEY`** (or token) for `sync-cursor-spend`.
- [ ] **`INTEGRATION_CURSOR=real`** when validated.

## OpenAI (ChatGPT + Codex)

- [ ] Org **admin** API key + **`OPENAI_ORG_ID`**.
- [ ] **`INTEGRATION_OPENAI=real`** when validated.
- [ ] Optional tuning: **`OPENAI_COST_LINE_ITEM_SUBSTRINGS_JSON`** / **`OPENAI_COST_UNMAPPED_SPLIT`** for F1 ChatGPT vs Codex split.

## Anthropic / M365 Graph / Azure OpenAI

- [ ] Per **`AGENTS.md` §6.1** — keys and org/workspace IDs; flip **`INTEGRATION_*=real`** only after smoke tests.

## Policy repo (write path / F6+)

- [ ] Repo **`wdts-ai-policy`** branch protection **before** issuing a PAT the dashboard could use to merge.
- [ ] Fine-grained PAT: `contents:write`, `pull_requests:write`; **`POLICYREPO_TOKEN`**; **`INTEGRATION_POLICYREPO=real`**.

## Deel (optional)

- [ ] **`DEEL_API_TOKEN`**, **`DEEL_WEBHOOK_SECRET`**, webhook URL registered — or rely on **CSV import** only.

## Scheduled jobs (GitHub Actions)

Repository secret **`CRON_SHARED_SECRET`** must match App Service. Workflows in `.github/workflows/`:

- [ ] `cron-reconcile-azuread.yml`
- [ ] `cron-vendor-spend-sync.yml` (Cursor + OpenAI spend)
- [ ] `cron-usage-mirror-health.yml` (optional; tighten `requireBatch` after ingest is mandatory)

Edit **`DASHBOARD_BASE_URL`** inside each workflow if the app is not hosted at
`https://wdts-ai-program-console.azurewebsites.net`.

## Hosting / network (v0.3+)

- [ ] Custom domain + TLS for OAuth UX (preview hostname limitations).
- [ ] VNet / private Postgres, Key Vault RBAC — per **`docs/deploy/azure.md`**.

When a row is blocked by policy or IT, capture the decision in the program
decision log or IT ticket; avoid “silent” flips of **`INTEGRATION_*`** in prod.
