# 0003 — Production deploy target: Azure App Service + Postgres FS + Key Vault + GHA OIDC

**Status:** accepted
**Date:** 2026-04-28
**Authors:** Cursor agent (drafting)
**Decider:** Anuj — signed off in chat 2026-04-28

## Context

Scoping §6 Q3 ("hosting target") and `AGENTS.md` §10 N1 / §13 "Hosting /
production" left the production deploy target deliberately open through
v0.2. v0.2 closed every code-side blocker (real integration clients,
auth, CI, schema-additions LDRs); the next thing standing between this
repo and a real environment is a documented, reviewable deploy story.

We have a useful precedent on the same Azure tenant — the personal-account
Streamlit deploys for the India and Australia "increment" apps
(`anujgoel61/india-increment-app`, `anujgoel61/australia-increment-app`).
Walking those gives us a known-good template for App Service Linux + a
catalogue of three things we explicitly should _not_ copy:

1. Plaintext secrets baked into a `deploy-azure.sh` and pushed as App
   Service application settings in cleartext.
2. Manual `az webapp deployment source config-zip` from a laptop.
3. Re-using the same Entra ID app registration across dev, sandbox, and
   production (so admin-consented Graph scopes — `Reports.Read.All`,
   `AuditLog.Read.All` — would land on the same registration the
   developer laptop signs into).

This LDR pins the production target shape so that the runbook in
`docs/deploy/azure.md`, the bootstrap script next to it, and the sample
GitHub Actions workflow all have one thing to point at.

## Decision

The dashboard's production deploy target is:

- **Compute** — Azure App Service, Linux, Node 20 LTS runtime, single
  region, B-tier (start at **B2** so `prisma migrate deploy` on cold
  start doesn't throttle; revisit once we have load data).
- **Database** — Azure Database for PostgreSQL **Flexible Server**,
  Postgres 16, Burstable B1ms, same resource group, **public network
  access disabled** — VNet-integrated with the App Service.
- **Secrets** — Azure Key Vault, with the App Service running under a
  **system-assigned managed identity** that has Key Vault Secrets User
  on the vault. Every secret is stored as a Key Vault secret and
  surfaced to the app via the `@Microsoft.KeyVault(SecretUri=…)`
  application-settings reference syntax. **No secret value ever lives
  in a deploy script, an App Setting cleartext value, or `.env*` in
  the repo.**
- **Identity (auth)** — a **fresh, prod-only** Microsoft Entra ID app
  registration, distinct from the dev/sandbox registration in
  `.env.local`. The prod app registration:
  - has only the production redirect URI(s) configured;
  - has the `groups` claim configured (`groupMembershipClaims=SecurityGroup`)
    so RBAC works without the email-rule fallback;
  - is the only registration that gets the high-privilege Graph
    admin-consent scopes (`User.Read.All`, `Reports.Read.All`, and
    `AuditLog.Read.All` once F11 lands).
  The dev/sandbox registration stays low-privilege and continues to
  cover local development.
- **CI/CD** — GitHub Actions only, **OIDC-federated** (no long-lived
  PAT or client secret stored in repo secrets). The federated
  credential is scoped to `repo:agoyalwdts/wdts-ai-program-console:environment:production`,
  the deploy job assumes a Service Principal in the prod resource
  group, and the GitHub `production` environment requires a manual
  approver before the job runs.
- **Region** — primary candidates are **`centralindia`** or **`eastus`**.
  Either is acceptable; the runbook parameterises the region so the
  same script works for whichever one IT picks. **`australiaeast` is
  _out_** — Anuj explicitly excluded it.
- **Hostname** — `*.azurewebsites.net` for the v0.2 dev preview. A
  custom domain is a v0.3 follow-up (see `README.md`), out of scope
  for this LDR.
- **HTTPS** — `--https-only true` set at create time. App Service
  serves both http and https unless this is flipped.

## Rationale

- **Azure App Service B2 Linux** has a working precedent on this exact
  tenant (the increment apps). Lowest path-of-resistance compute for a
  small Next.js app. Stateless tier ⇒ horizontal scale-out is trivial
  later.
- **Postgres Flexible Server** is the natural Azure-native counterpart
  to the Prisma stack we already commit to. Burstable B1ms is enough
  for ≤100 users, the program's stated cap.
- **Managed identity + Key Vault** is the standard Azure secret-handling
  pattern and removes every other place a secret could leak. The
  increment-app deploy demonstrated empirically that App Settings
  cleartext is a real exposure surface; Key Vault refs neutralise it.
- **Prod-only AAD app registration** is the move that lets us request
  admin consent for `Reports.Read.All` without that consent
  back-propagating to the developer laptop. It is also what makes the
  reconciler logs distinguishable in audit (one app id = production).
- **OIDC-federated GitHub Actions** removes the last "long-lived secret
  in a repo" surface. Increment apps' `deploy-azure.sh` baked the
  client secret directly into the script; the federated credential
  pattern means the GitHub workflow exchanges its short-lived OIDC
  token for an Entra ID access token at deploy time, with nothing to
  rotate or leak.
- **B2 not B1** for Node — the increment apps used B1 for Python +
  SQLite + a single-process Streamlit. We have `prisma migrate deploy`
  on startup plus `next start` plus the hot path through Prisma, and
  cold start on B1 is the failure mode that turns a 30-second deploy
  into a five-minute one. Cheap to revisit.
- **Region: India or US, not Australia.** Anuj's call. The data the
  dashboard stores is engineering metadata — AAD object IDs, emails,
  manager links, decision/exception/reclamation rows — with no
  payroll, no PII beyond display name + email, and **never any
  prompt/response bodies** (those live in the gateway audit log per
  `AGENTS.md` §3). Either region is compatible with that data
  inventory; the choice can defer to whichever has the rest of WDTS's
  Azure footprint.

## Alternatives considered

| Alternative | Why it lost |
|---|---|
| Azure Container Apps + Postgres FS | Cleaner for a containerised app, but Next.js standalone has a working "node + zip" deploy story on App Service that we already have a precedent for, and Container Apps adds an ACR + container build step we don't need yet. Worth revisiting once we have multi-region or sidecar requirements. |
| Vercel / Netlify | Auth.js + Microsoft Entra ID + Prisma + Postgres works, but the Postgres has to live somewhere with VNet connectivity to Microsoft Graph for the reconcilers — that pushes us back into Azure for the DB anyway. Splitting compute and DB across providers adds latency and a new auth boundary for no real benefit. |
| AKS | Way over-spec for ≤100 users. Comes back into the conversation only if we end up needing co-tenanted services (e.g. an internal model gateway running alongside the dashboard). |
| Single region, multi-region active/active | Out of scope for v0.3 — no SLA contract that requires it, and the failure mode is "the dashboard is down for 30 min during region failover", which is acceptable for a workflow tool. |
| Reuse the dev/sandbox AAD app registration in production | What the increment apps did. Conflates dev sign-ins with the principal that holds `Reports.Read.All`. Loses the audit-log distinguishability. Strict net negative. |
| GitHub Actions with a long-lived federated client-secret instead of OIDC | Slightly less work to set up; equally a long-lived secret in `secrets.AZURE_CLIENT_SECRET`. OIDC removes the rotation surface entirely — no reason not to. |
| Region `australiaeast` | Anuj excluded it explicitly. (The Australia increment app is unrelated to where this dashboard's WDTS audience sits.) |
| Manual zip-deploy from a laptop (the increment-app pattern) | No reproducibility, no audit trail of who deployed what, no separation between "I have laptop access" and "I can ship to prod". |

## Consequences

**Code / repo:**

- `docs/deploy/azure.md` — full runbook. Source of truth.
- `docs/deploy/azure-bootstrap.sh` — sample one-shot provisioning
  script, parameterised on region + RG + app name. Marked
  "draft / pending IT sign-off / NOT auto-runnable in CI".
- `docs/deploy/deploy.yml.sample` — sample GitHub Actions workflow.
  Stored as `.sample` (not under `.github/workflows/`) so it cannot
  trigger before the prod resource group, the service principal, the
  federated credential, and the `production` GitHub environment exist.
  Promoting it to active is a deliberate copy-into-place step,
  documented in the runbook.
- `AGENTS.md` §13 — "Hosting / production" subsection rewritten to
  point at the runbook and to enumerate the Tier-0 inputs the runbook
  needs (subscription / RG / region / SKU choice / approver list).
- `README.md` — link to runbook from "v0.3 follow-ups".

**Process:**

- Promoting `deploy.yml.sample` → `.github/workflows/deploy.yml`
  requires the human reviewer (per `AGENTS.md` N4) to confirm:
  prod resource group exists, service principal exists, OIDC
  federated credential exists, GitHub `production` environment
  exists with at least one required reviewer.
- Rotating any secret that lands in Key Vault is now a Portal /
  `az keyvault secret set` operation — no code change, no redeploy.
  This is the rotation pattern that should retroactively apply to
  the dev/sandbox `AZURE_AD_CLIENT_SECRET` (today in `.env.local`)
  whenever it's rotated.

**Failure modes:**

- App Service B2 still throttles `prisma migrate deploy` → bump to
  S1 (per-instance, not per-plan) for one deploy and back to B2.
  This is a knob, not a redesign.
- Postgres Flexible Server B1ms hits CPU on chargeback queries → bump
  to B2s. Same shape.
- Federated credential drift (repo renamed / branch policy changed)
  → deploy job fails closed with a clear "Could not exchange OIDC
  token for AAD token" error. Strictly better than a silent secret
  expiry.

## Open follow-ups

- **Subscription + resource group + region** — the actual Tier-0
  inputs (`AGENTS.md` §10 N1, §13 Hosting/production). The runbook
  parameterises all three; this LDR doesn't pick them.
- **Custom domain + TLS cert source** — Front Door vs App Service
  managed cert vs Key Vault-imported cert. Defer to v0.3 once
  the domain itself is allocated.
- **Production-grade Postgres SKU** — B1ms is the runbook default;
  the upgrade trigger is the first time we see CPU above 70% on a
  manager dashboard render. Revisit when there's load data.
- **Front Door / App Gateway in front** — only required if we add
  WAF rules, geo-blocking, or multi-region. Out of scope for now.
- **Secret rotation cadence** — Key Vault doesn't enforce one. We
  should pick a default (90 days?) when the prod app registration
  lands, and write that into `AGENTS.md` §13.
- **Observability stack** — Application Insights vs Log Analytics
  vs ship logs to the gateway's destination. Not blocking the
  deploy; defer to a separate ADR when we wire it.
