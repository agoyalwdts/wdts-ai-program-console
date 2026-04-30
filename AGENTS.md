<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# WDTS AI Program Console — agent playbook

This file is the steady-state playbook for any Cursor agent picking up the build.
Read it end-to-end before touching code, then read the docs in §1 in the same order.

---

## 1. Read these first, in this order

1. `README.md` (this repo) — what the project is, how to run it, the v0.1
   known limitations, the v0.2 follow-up backlog.
2. `/Users/anujgoyal/Downloads/ai-guardrails-pass/Dashboard_Scoping_v1.md`
   (v0.2) — program-level scoping doc. Pay special attention to:
   - §1 — strategic posture (memorise it).
   - §2 — v1 / v1.1 / v1.2 feature list (F1–F15).
   - §3 — canonical data model + source-of-truth boundaries (§3.3).
   - §4 — integration order + the synthetic-vs-real client pattern.
   - §5 — phased delivery plan.
   - §8 — resolved + new operational questions (N1–N7) — most need IT/Security input.
   - §9 — build conventions for an agent-led implementation.
3. `/Users/anujgoyal/Downloads/ai-guardrails-pass/Executive_Policy_and_Guardrails.md`
   — only §0 (license footprint table) and §4.6 (tier model). Skim Appendix H
   (FinOps) if you need budget-allocation logic.
4. The `.cursor/rules/*.mdc` files in this repo. They are short and binding.
5. `docs/decisions/` — the lightweight decision log. Read every record with
   `Status: accepted`; **proposed** records are in flight and may not yet
   reflect the codebase. The README in that folder explains the format and
   the sign-off rule.
6. The most recent `Decision` row in the dev DB (it tells you what the previous
   session decided, in case it predates a commit):
   ```bash
   PGPASSWORD=wdts_dev psql -h localhost -p 5432 -U wdts -d wdts_ai_console \
     -c 'SELECT ts, type, justification FROM "Decision" ORDER BY ts DESC LIMIT 5;'
   ```
7. `git log --oneline -20` and `gh pr list --state open` to see what's in flight.

---

## 2. Project purpose

A Next.js + Postgres operator dashboard for WDTS's AI Guardrails program. It
surfaces program-level state across the five approved AI products — **Cursor /
ChatGPT / Codex / Claude.ai / M365 Copilot** — to FinOps, Engineering Mgmt,
Security, and Steering. v0.1 is read-only and synthetic-data-driven. v0.2+
wires real integrations and adds the write path (tier moves, reclamation,
exceptions) per scoping §2.

The dashboard is a **thin workflow layer**, not the source of truth — see §3.

---

## 3. Strategic posture (do not violate)

Authoritative state lives in:

- The policy repo at https://github.com/agoyalwdts/wdts-ai-policy (separate repo; the dashboard reads/writes via PRs against it, never directly).
- The IdP — Microsoft Entra ID — for **identity** (sign-in, MFA, JML).
- The gateway audit log (vendor TBD per scoping §8 N-series).

The dashboard owns authoritatively:

- `Decision`, `ExceptionRequest`, `ReclamationEvent` (append-only operational
  ledger; exported nightly to a WORM Azure Blob in v0.2+).
- **Dashboard authorization** — `Role`, `User.dashboardRoleId`,
  `User.disabled`, `User.isOwner`, **and the access list itself** (LDR 0005).
  AAD provides identity; the dashboard decides who's allowed in and what
  they can do once they're in. Sign-in is **closed by default** — only
  emails with a `User` row (or matching the bootstrap-owner rule) can
  sign in; anyone else gets the `/access-denied` page. The owner adds
  people via `/settings/users → Invite user`. **AAD security groups are
  not used for authorization.** Future scope: a v0.4+ optional binding
  between `Role` rows and AAD group OIDs is sketched in LDR 0005's Open
  follow-ups — do not start it without an explicit trigger.

If the dashboard is wiped, the program continues; the dashboard is rebuilt
from the policy repo + audit log + a fresh seed.

### Forbidden moves

- Never write directly to a vendor API. Every write goes via a policy-repo PR.
- Never log full prompt/response bodies. The gateway already does that under
  controlled retention.
- Never bypass the auth wrapper for any route. v0.1 stubs it; v0.2 enforces
  401 on missing session.
- Never store DLP secrets in plain text.
- Never check in real `.env` values. The committed `.env` is local-dev only and
  explicitly marked.
- Never add new vendors / integrations beyond the §4 list in the scoping doc
  without reviewer approval.

---

## 4. Tech stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) — see banner at top of file: do not assume training-data Next |
| Language | TypeScript, **`strict: true`** — see `tsconfig.json` |
| UI | React 19 Server Components first; Client Components only when needed |
| Styling | **Tailwind v4** utility classes only. No inline `style={{ ... }}`, no CSS-in-JS, no global CSS beyond `app/globals.css` |
| Primitives | **shadcn/ui** conventions; v0.1 ships them inline in `components/ui/*` (CLI was hanging on auth in non-interactive mode); v0.2+ can re-generate via `npx shadcn add` |
| Charts | recharts (`components/charts/*`) |
| ORM | **Prisma v6** — pinned because v7 deprecated `datasource.url` in `schema.prisma` (would force a `prisma.config.ts` migration) |
| DB | Postgres 16 — Docker (`docker-compose.yml`) or Homebrew `postgresql@16` |
| Auth (v0.1) | STUB — `lib/auth.ts` returns `admin@wdts.com` |
| Auth (v0.2) | NextAuth + Azure AD provider — see scoping §4 integration #1, §8 N2 |

### Conventions

- **Server Components query Prisma directly.** Don't add API routes for
  page data — only when the response genuinely is non-page (e.g. CSV download,
  webhooks, mutations).
- **Tailwind only.** No inline styles. Prefer `cn()` from `lib/utils.ts` for
  conditional class merging.
- **Use the helpers** in `lib/utils.ts` — `formatUsd()`, `initials()` — for
  consistent rendering.
- **Every stub file** carries a banner comment with `TODO(v0.2)` and a pointer
  to the scoping section that supersedes it.
- **Single source of truth for program numbers** (budgets, sub-tier caps, seat
  quotas, region list) lives in `lib/program.ts`. F1 reads from there.

---

## 5. Run commands

```bash
# 1) install deps
npm install

# 2a) start Postgres via Docker (preferred when Docker is available)
docker compose up -d

# 2b) ...or use a native Postgres (the README documents this fallback;
#     it is what was actually used during v0.1 verification on this machine).
brew services start postgresql@16
createdb wdts_ai_console   # one-time; expects the user/pass in .env

# 3) apply migrations + deterministic synthetic seed
npx prisma migrate deploy   # fresh setup; replays prisma/migrations/*
npx prisma db seed

# 4) dev server
npm run dev          # http://localhost:3000 → redirects to /health

# one-shot reset
npm run db:reset     # prisma migrate reset --force (drops + re-migrates + re-seeds)

# schema change (v0.2 canonical workflow)
npm run db:migrate -- --name <short_intent>   # creates + applies migration
```

---

## 6. Project structure

```
wdts-ai-program-console/
├─ auth.ts                       # Auth.js v5 root config (Microsoft Entra ID provider)
├─ proxy.ts                      # Next 16 proxy (was middleware.ts) — gates everything
├─ app/
│  ├─ (dashboard)/
│  │  ├─ layout.tsx              # sidebar + topbar shell
│  │  ├─ health/page.tsx         # F1 — Program Health
│  │  ├─ users/page.tsx          # F2 — Per-User
│  │  ├─ managers/page.tsx       # F3 — Per-manager queue
│  │  ├─ cursor-seats/page.tsx   # F4 — 120-seat board (4 sub-tiers) + waitlist
│  │  ├─ decisions/page.tsx      # F5 — append-only ledger
│  │  ├─ codex-ladder/page.tsx   # F9 — Codex tier distribution + queues
│  │  ├─ chargeback/page.tsx     # F10 — per-team monthly bill
│  │  └─ settings/page.tsx       # stub
│  ├─ api/auth/[...nextauth]/route.ts   # NextAuth handlers (signin, callback, signout, etc.)
│  ├─ api/cron/reconcile-azuread/route.ts # HMAC-protected cron trigger (no session)
│  ├─ api/decisions/export/route.ts     # CSV export for F5 (auth-gated by proxy)
│  ├─ layout.tsx                 # html shell
│  └─ page.tsx                   # redirects → /health
├─ components/
│  ├─ ui/         # local shadcn-style primitives (Card / Badge / Button / Input / Table)
│  ├─ charts/     # SpendTrendChart, BudgetBar
│  └─ dashboard/  # Sidebar, Topbar
├─ lib/
│  ├─ prisma.ts             # singleton client
│  ├─ auth.ts               # dashboard-facing auth helpers (requireUser/requireRole/requirePermission)
│  ├─ auth-roles.ts         # pure role-mapping (testable; DB-first + bootstrap email rule)
│  ├─ cron/
│  │  └─ auth.ts            # HMAC verify/sign helpers used by /api/cron/* (pure, testable)
│  ├─ rbac/
│  │  ├─ permissions.ts     # code-defined permission catalogue
│  │  └─ built-in-roles.ts  # USER / MANAGER / FINOPS / ADMIN definitions, seeded into DB
│  ├─ program.ts            # program constants
│  ├─ synthetic-data.ts     # STUB — synthetic generator used by `prisma/seed.ts`
│  ├─ integrations/         # vendor abstractions (scoping §4); see §6.1 below
│  └─ utils.ts              # cn(), formatUsd(), initials()
├─ prisma/
│  ├─ schema.prisma         # canonical models — see §3 of LDR 0001 for the v0.3 shape
│  ├─ seed.ts               # deterministic 30-user seed (also seeds the v0.3 tables)
│  ├─ scripts/              # invoke-by-hand reconcilers (e.g. reconcile-azuread.ts)
│  ├─ migrations/           # SQL artefacts; the latest is 20260429_v0_3_schema (LDR 0001)
│  └─ v0_3-models.db.test.ts  # DB-integration tests for the four v0.3 models
├─ docker-compose.yml
├─ .env                     # DATABASE_URL — local dev only
├─ .cursor/rules/*.mdc      # binding rules for future agent sessions
├─ AGENTS.md                # this file
└─ README.md
```

`v_user_current_posture`, `v_program_health`, `v_manager_queue`,
`v_cursor_seat_board`, `v_codex_ladder` (scoping §3.2) are **not** materialised
in v0.1 — Server Components compute equivalents inline. v0.2+ should consider
landing them as raw migrations once the data volume justifies it.

### 6.1 Integration layer — `lib/integrations/`

Nine vendor abstractions per scoping §4. Each has the same four-file shape:

```
lib/integrations/<name>/
  types.ts       # interface definition
  synthetic.ts   # deterministic implementation (reads from dev DB where applicable)
  real.ts        # real vendor client — wired against the real vendor API
  real.test.ts   # mocked-fetch contract tests for the real client
  index.ts       # exports get<Name>Client(env) — picks synthetic vs real by env var
```

| Client | Env var | Unlocks | Real status |
|---|---|---|---|
| `gateway`     | `INTEGRATION_GATEWAY`     | F1 / F2 / F3 / F11 / F12 | **synthetic only** (vendor TBD per Phase 0) |
| `cursor`      | `INTEGRATION_CURSOR`      | F4 / v1.1 reclamation    | **landed** — SCIM 2.0 |
| `openai`      | `INTEGRATION_OPENAI`      | F1 / F2 / F10            | **landed** — Admin API `/organization/users` |
| `anthropic`   | `INTEGRATION_ANTHROPIC`   | F1 / F2 (Claude)         | **landed** — Workspaces Admin API |
| `m365graph`   | `INTEGRATION_M365GRAPH`   | F13 (Copilot)            | **landed** — Graph `/users` + `/reports` |
| `azuread`     | `INTEGRATION_AZUREAD`     | identity sync, NextAuth  | **landed** — Graph `/users` + reconciler script |
| `deel`        | `INTEGRATION_DEEL`        | role_tag / manager_id    | **landed** — REST `/people` + HMAC webhook |
| `policyrepo`  | `INTEGRATION_POLICYREPO`  | v1.1 write path          | **landed** — GitHub Contents API |
| `azureopenai` | `INTEGRATION_AZUREOPENAI` | future Codex bring-up    | **landed** — control-plane probe |

Defaults: every var unset = `synthetic`. Set to `real` per-env once the
operational unblocks in §13 are cleared. See `lib/integrations/index.ts`
for the comment block describing how to add a tenth client.

A small shared HTTP helper (`lib/integrations/_http.ts`) provides
`jsonGet` + `paginate` — used by every bearer-token / JSON real client to
keep them small. Auth-bearing clients that hit Microsoft Graph reuse the
token cache + paginator in `lib/integrations/azuread/graph.ts`.

F1/F2/F3/F4/F9/F10 read through the clients (gateway / cursor / openai /
azuread / deel). F5 stays on Prisma directly: `Decision` is
dashboard-authoritative (scoping §3.3), not a vendor mirror, so there's
nothing to abstract.

---

## 7. Test discipline

- **v0.1 had no tests.** v0.2 introduces them incrementally.
- **Vitest** is wired (`npm test`, `npm run test:watch`). There are two
  flavours of test, distinguished by file naming:
  - **Unit / pure-function tests** in `**/*.test.ts` — no DB, no network.
  - **DB-integration tests** in `**/*.db.test.ts` — connect to the test DB
    and assert against the deterministic seed. Read-only (parallel workers
    share the DB).
- **Test database**: a separate Postgres database named
  `<dev-db-name>_test` on the same instance as the dev DB. Vitest's
  `globalSetup` (in `tests/global-setup.ts`) creates it if missing, runs
  `prisma migrate deploy`, and reloads the seed every test run. Workers
  override `DATABASE_URL` via `tests/setup-files.ts`.
- **One-shot setup**: `npm run db:test:setup`. Idempotent. Useful when you
  want to inspect the test DB with psql.
- **CI** runs on every PR + every push to `main` via `.github/workflows/ci.yml`:
  - `npm run typecheck` (strict `tsc --noEmit`)
  - `npm run lint`
  - `npm test` (vitest globalSetup auto-provisions a `<dev>_test` DB on the
    workflow's Postgres 16 service container)
  - You can replicate the full CI gate locally with `npm run ci`.
- **Still to add**, per scoping §9.2:
  - **Vitest API route tests** for `app/api/**/route.ts` (e.g.
    `/api/decisions/export`).
  - **Playwright** end-to-end against the synthetic-data dev environment for
    each F-feature flow.

When in doubt, follow the rule from scoping §9.2: ship tests with the
feature, not as a follow-up PR.

---

## 8. Commit and PR discipline

- **Remote**: `https://github.com/agoyalwdts/wdts-ai-program-console`
  (private, WDTS-owned). All work flows through GitHub PRs from this point on
  — the v0.1/v0.2 local `--no-ff` merge pattern is retired.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`).
- **Small commits** — aim for 30–80 lines of net-new code per commit. One
  logical change per commit.
- **Branching** — feature branches off `main`, named `<type>/<short-slug>`
  (e.g. `feat/exception-requests`, `chore/ci-workflow`). Never commit
  directly to `main`.
- **Local CI gate before opening a PR**: `npm run ci`. CI on GitHub Actions
  re-runs the same three checks (`typecheck` + `lint` + `test`) plus a real
  Postgres 16 service container for the DB-integration tests. A PR is
  mergeable only when CI is green.
- **PRs for every feature.** Open with `gh pr create`. The PR description
  includes:
  - which F-number from scoping §2 this implements,
  - what was added / changed,
  - what tests were added,
  - any open question for the human reviewer.
- **No direct pushes to `main`.** Once branch protection is enabled on
  github.com (require PR + green CI before merge), the agent will not be
  able to push to `main` even by accident.
- **Every write-path PR** must wrap the change in a `Decision` row before the
  policy-repo PR is opened (scoping §9.1 last bullet).

---

## 9. Resuming across agent sessions

Every fresh agent session, before writing code:

1. Read this file (`AGENTS.md`) and the rules in `.cursor/rules/`.
2. Read the §1-listed sections of the scoping doc.
3. Pull the most recent 5 `Decision` rows from the DB — they are the most
   recent program-level decisions, sometimes ahead of any commit.
4. `git log --oneline -20` and `gh pr list --state open` to see in-flight work.
5. If the previous session left a partial PR open, decide explicitly whether
   to finish it or revert and start over with a clear plan. Do not silently
   continue partial work.

---

## 10. Deferred to v0.2+ (do not implement without direction)

These are explicitly out of scope until the user / human reviewer says go.
They map to scoping §2.

| Area | What's deferred | Scoping ref |
|---|---|---|
| ~~Auth~~ | **Landed** — Auth.js v5 (`auth.ts` at root) + Microsoft Entra ID provider (identity only), JWT sessions, strict gating via `proxy.ts` (Next 16 rename of middleware), `requireUser()` / `requireRole()` / `requirePermission()` helpers in `lib/auth.ts`. **App-level RBAC** (LDR 0005) — `Role` table + `User.dashboardRoleId`, JIT-provisioning on first sign-in, `/settings/users` and `/settings/roles` admin UI. AAD groups are intentionally NOT used. | §4 #1, §6 Q2, §8 N2, LDR 0005 |
| ~~F3 Manager queue~~ | **Landed** — `/managers` route reads through `getGatewayClient().managerQueue()` (synthetic). v0.2 evolves the "pending recommendations" surface from `Decision` rows to dedicated `ReclamationEvent` / `ExceptionRequest` models | §2 v1 row 3 |
| ~~F1/F2/F4 → integration clients~~ | **Landed** — `health`, `users`, `cursor-seats` all consume `getGatewayClient()` / `getCursorClient()` / `getAzureADClient()` / `getDeelClient()`. F5 intentionally stays on Prisma | §4 |
| ~~Test DB infra~~ | **Landed** — Vitest globalSetup provisions `<db>_test` and runs migrations + seed; `**/*.db.test.ts` files connect to it. First DB-integration test exercises `syntheticGatewayClient` | §9.2 |
| ~~F9 Codex ladder~~ | **Landed** — `/codex-ladder` shows tier distribution + promotion / demotion / dormancy queues using `getOpenAIClient().listCodexSeats()` | §2 v1.1 row 4 |
| ~~F10 Overage / chargeback~~ | **Landed** — `/chargeback` groups spend by manager line (v0.2 stand-in for cost centre); ADR 0002 (`docs/decisions/0002-cost-centre-key.md`) proposes the real `User.costCentre` field — needs sign-off | §2 v1.1 row 5 |
| ~~Integration real clients~~ | **Landed** — every real client except `gateway` (vendor TBD) is wired with mocked-fetch contract tests. See §6.1 + §13 for what's still operationally blocked. | §4 |
| ~~AzureAD identity reconciler~~ | **Landed** — `npm run reconcile:azuread` mirrors Graph users → Prisma; wraps each pass in a `Decision` | §4 #2 |
| ~~AzureAD reconciler — manager hierarchy~~ | **Landed** — `realAzureADClient.listUsers()` uses `$expand=manager` so the reconciler resolves `User.managerId` in a second pass; counters: `managerEdgesLinked` / `managerEdgesCleared` / `managerEdgesUnresolved` | §4 #2 |
| ~~AzureAD reconciler — cron endpoint~~ | **Landed** — `POST /api/cron/reconcile-azuread`, HMAC-protected via `CRON_SHARED_SECRET`. Pluggable trigger (GitHub Actions schedule / Logic Apps / external uptime) — see runbook §"Cron triggers" | §4 #2 |
| ~~Deel webhook receiver~~ | **Landed** — `/api/webhooks/deel` HMAC-verifies + records a `Decision` row; needs `DEEL_WEBHOOK_SECRET` set + Deel-side webhook URL registered to go live | §4 #3 |
| ~~CSV employee import~~ | **Landed** — `/settings/imports` page + `POST /api/imports/employees`. Removes Deel from the Tier-0 blocker list; runbook in `docs/imports/README.md` | §4 #3 (alt path) |
| F6 Tier promotion / demotion | Write-path via policy-repo PR (GitHub API), SCIM update flow | §2 v1.1 row 1 |
| F7 Reclamation + dispute | 5-business-day dispute window, trigger UI, notifications | §2 v1.1 row 2 |
| F8 Exception flow | §16.3 manager attestation → FinOps → Steering routing, 30-day TTL | §2 v1.1 row 3 |
| F11 Friction Budget KPIs | §17.5 weekly metrics + auto-rollback indicator | §2 v1.2 row 1 |
| F12 Anomaly detection | Outlier spend, sudden cap exhaustion, unusual model usage | §2 v1.2 row 2 |
| F13 Copilot rationalisation | Telemetry + survey + Deel role tag cross-reference | §2 v1.2 row 3 |
| F14 Bypass-mechanism alerts | §11.6 — `--dangerously-bypass`, `approval_policy="never"`, Cursor Auto-Run | §2 v1.2 row 4 |
| F15 Shadow-AI signals | Network egress to un-allowlisted AI endpoints | §2 v1.2 row 5 |
| Schema gaps | `ExceptionRequest`, `ReclamationEvent`, `BudgetSnapshot`, `FrictionBudgetMetric` rows + the §3.2 SQL views — proposed in ADR 0001 (`docs/decisions/0001-v0.3-schema.md`); needs sign-off | §3.1 |
| Decision-log hardening | Trigger-level row immutability + nightly WORM export to Azure Blob | §3.3 |
| Hosting | Azure App Service / Container Apps + Postgres Flexible Server + Key Vault + Front Door + GH Actions CI | §6 Q3 |
| Tests + CI | **Landed**: Vitest (unit + DB + API-route mocked tests, 115/115 passing) + GitHub Actions CI on every PR + push to `main`. Playwright e2e still to add | §9.2 |
| Prisma 7 migration | Move `datasource.url` to `prisma.config.ts` adapter, lift the v6 pin | n/a (workaround note in `prisma/schema.prisma`) |
| shadcn CLI re-gen | Re-run `npx shadcn add` for `components/ui/*` once the auth-prompt environment is sorted | n/a |

### Cleared-to-clear-first (scoping §8 new questions)

Don't deploy or wire production integrations until these are answered by IT /
Security / the human reviewer:

- **N1** — Azure subscription / resource group for the dashboard.
- **N2** — Domain name for the deployed dashboard.
- **N3** — GitHub org / repo for the dashboard.
- **N4** — Named human reviewer (full-stack ~8h/wk + Security ~2h/wk).
- **N5** — Cursor seat for the build agent (from the §4.6.1 reserve).
- ~~**N6** — Deel API access + webhook endpoint.~~ Reframed: no longer a
  Tier-0 blocker. CSV employee import (`/settings/imports`, see Track 8
  below) covers the same need without Deel. Deel is now an *optional*
  reconciler that lands when API access is granted.
- **N7** — M365 admin scoped service principal for Microsoft Graph (read-only
  for v1: `User.Read.All`, `Reports.Read.All`, `AuditLog.Read.All`).

---

## 11. Workarounds in v0.1 (revisit when hardening)

- **Prisma pinned to v6.** v7 deprecated `datasource.url` in `schema.prisma`.
  See banner at top of `prisma/schema.prisma`. Lift the pin during v0.2.
- **`components/ui/*` are inline** rather than `npx shadcn add`-generated. The
  CLI hung on a non-interactive auth prompt during the v0.1 build. They follow
  shadcn conventions and can be re-generated cleanly later.
- **Docker not auto-installed.** The build agent doesn't have permission to
  install Docker Desktop; the run order assumes the user starts Postgres
  themselves (Docker or native via Homebrew).

---

## 12. Architecture / program decisions

`docs/decisions/` is the dashboard's lightweight decision-record (LDR)
log. Read every record with `Status: accepted` before touching code that
the record covers. **Proposed** records may not yet reflect the codebase.

Current index:

| # | Title | Status |
|---|---|---|
| 0001 | v0.3 schema additions: ExceptionRequest, ReclamationEvent, BudgetSnapshot, FrictionBudgetMetric | proposed |
| 0002 | Canonical cost-centre key on User | proposed |
| 0003 | Production deploy target: Azure App Service + Postgres FS + Key Vault + GHA OIDC | accepted |
| 0004 | Cursor is credit-bound, not seat-bound: 4 sub-tiers, 120-seat plan inside a $500K/yr envelope | accepted |
| 0005 | App-level RBAC: dashboard owns its own access control (AAD = identity only) | accepted |

The README in that folder explains the format and the proposed→accepted
sign-off rule.

---

## 13. Open blockers (operational)

Every real client landed in v0.2 — `INTEGRATION_*=real` flips them on, but
each needs an external action before it can serve real data. This is the
canonical list.

### Auth + identity (Tracks 2, 3)

- ✅ Auth.js + Microsoft Entra ID provider wired. Sandbox-tenant working.
- ✅ **Production AAD app registration** live in the WDTS Entra tenant
  (`wdts-ai-program-console (prod)`, separate from the dev/sandbox app).
  Admin consent granted for `User.Read.All` and `Reports.Read.All`.
  Identity-only — the `groups` claim is no longer read by the
  dashboard for authorization (LDR 0005). Conditional Access on this
  app reg is the recommended way to gate sign-in itself if needed.
- ✅ **App-level RBAC** (LDR 0005). `Role` table seeded with four
  built-ins; the owner row (`isOwner=true`) is provisioned via
  `prisma/seed.ts`. **Closed-by-default sign-in**: a `signIn` callback
  in `auth.ts` rejects emails that don't have a `User` row (and aren't
  the bootstrap admin), redirecting them to a public `/access-denied`
  page. Owner invites people via `/settings/users → Invite user`
  (`POST /api/admin/users`); the row appears immediately and the
  invitee can sign in straight away. Role + permissions in the JWT,
  admin UI at `/settings/users` and `/settings/roles`. The bootstrap
  email rule in `lib/auth-roles.ts` exists only for fresh-DB /
  new-tenant recovery.
- 🗒️ **Future scope**: optional AAD-group → Role binding (LDR 0005
  "Open follow-ups"). Do **not** start without an explicit trigger.
- ✅ **AzureAD client in prod** (`INTEGRATION_AZUREAD=real`, flipped
  2026-04-29). Reuses the same prod app reg + admin-consented
  `User.Read.All` scope as M365 Graph.
- ✅ **AzureAD reconciler — manager hierarchy.** `listUsers()` now
  uses `$expand=manager($select=id,mail,userPrincipalName)` to return
  manager edges in one call, and the reconciler resolves them into
  `User.managerId` in a second pass. Counters: `managerEdgesLinked` /
  `managerEdgesCleared` / `managerEdgesUnresolved` (latter is when
  Graph names a manager who isn't in Prisma yet — picked up next run).
- ✅ **AzureAD reconciler — HMAC-protected cron endpoint.**
  `POST /api/cron/reconcile-azuread` runs the reconciler when called
  with a valid `x-cron-signature` (HMAC-SHA256 of the raw body using
  `CRON_SHARED_SECRET`). 503 if the secret is unset (fail-closed),
  401 on signature mismatch, 200 with a `ReconcilerSummary` on
  success. See `docs/deploy/azure.md §"Cron triggers"` for the
  GitHub-Actions-schedule wiring + `openssl rand -hex 32` setup.
- ⏳ **AzureAD reconciler — schedule.** Endpoint exists; nobody is
  hitting it on a clock yet. The recommended trigger for v0.3 is a
  GitHub Actions `schedule:` workflow that holds a copy of the
  shared secret as a repo secret and POSTs nightly. Until that wires
  up, prod still drifts; an operator should manually `curl` the
  cron endpoint at least weekly with `{"dryRun":true}` to detect drift.

### Cursor (Track 4)

- ⏳ **SCIM provisioning** enabled on the WDTS Cursor Enterprise
  workspace. Then publish `CURSOR_SCIM_BASE_URL` (e.g.
  `https://cursor.com/api/scim/v2`) and a `CURSOR_ADMIN_TOKEN`. Flip
  `INTEGRATION_CURSOR=real` and verify via `/settings`.

### OpenAI Enterprise (Track 5)

- ⏳ **Admin API key** issued under organisation settings (distinct from
  regular API keys). Set `OPENAI_ADMIN_API_KEY` + `OPENAI_ORG_ID`.

### Anthropic (Track 6)

- ⏳ **Workspace admin key**. Set `ANTHROPIC_ADMIN_API_KEY`,
  `ANTHROPIC_ORG_ID`, `ANTHROPIC_WORKSPACE_ID`.

### Microsoft Graph (Track 7)

- ✅ **Admin consent granted** on the production AAD app for
  `User.Read.All` and `Reports.Read.All` (verified in the Entra portal
  on 2026-04-28).
- ✅ **`INTEGRATION_M365GRAPH=real` flipped in prod** on 2026-04-29.
  F1's Copilot adoption + activity tiles now read live data from
  `/v1.0/users` (license filter on the Copilot SKU) and
  `/reports/getMicrosoft365CopilotUsageUserDetail` instead of the
  synthetic generator.
- ⏳ Optional **`M365_COPILOT_SKU_IDS`** if WDTS uses non-default
  Copilot SKU variants.

### Deel HRIS (Track 8) — now optional

- ✅ **CSV employee import** landed (`/settings/imports`,
  `POST /api/imports/employees`, see `docs/imports/README.md`). Lets an
  operator upsert the `User` table from a roster export without Deel.
  This is what removed Deel from the Tier-0 blocker list.
- ⏳ **Deel API token** (still useful when it lands). Set `DEEL_API_TOKEN`.
- ⏳ **Webhook receiver**. Generate `DEEL_WEBHOOK_SECRET`, set on both
  the dashboard side and in Deel admin, register
  `https://<dashboard-host>/api/webhooks/deel` as the receiver URL.
- ⏳ **Deel reconciler** (parallel to the AzureAD one) to apply
  webhook-implied state changes to Prisma. Currently webhooks land a
  `Decision` row but don't mutate `User`/`License` — by design (advisory
  hints, not authoritative writes). When this lands, the CSV path stays
  as the fallback for tenants without Deel.

### Policy repo (Track 9)

- ✅ **Repo created**: https://github.com/agoyalwdts/wdts-ai-policy.
  `POLICYREPO_OWNER` + `POLICYREPO_NAME` already populated in
  `.env.local`.
- ⏳ **Branch protection** on the policy repo so the dashboard's PAT
  cannot merge its own PRs. **Do this BEFORE issuing the PAT** —
  otherwise the PAT can self-merge.
- ⏳ **Fine-grained PAT** scoped to the policy repo with
  `contents:write` + `pull_requests:write`. Set `POLICYREPO_TOKEN` in
  `.env.local`, then flip `INTEGRATION_POLICYREPO=real`.

### Schema + cost-centre (Tracks 10, 11)

- ✅ **ADR 0001** (v0.3 schema additions) accepted + landed on
  2026-04-29. The migration `20260429_v0_3_schema` adds the four new
  models (`ExceptionRequest`, `ReclamationEvent`, `BudgetSnapshot`,
  `FrictionBudgetMetric`), lifts five string columns to Postgres enums
  (`UserStatus`, `Product`, `LicenseSource`, `UsageDecision`,
  `DecisionType`), adds `EMPLOYEE_IMPORT` to `DecisionType`, and applies
  three field fixes (`User.roleTag` nullable, `User.updatedAt`
  `@updatedAt`, `UsageRecord.dlpLayersHit` `String[]`). The seed exercises
  every new table; 12 new DB-integration tests in
  `prisma/v0_3-models.db.test.ts` lock the seed shape in.
- ⏳ **F6–F8 write paths.** Schema unblocks them; implementation pending.
  Tier promotion / demotion via policy-repo PR (F6/F7), reclamation
  state-machine driver (F4 dispute-window job), exception flow UI (F8).
- ⏳ **`BudgetSnapshot` materialisation job.** Skeleton — read-side
  consumers can already use the seeded rows. Tracked under
  `docs/decisions/0001-v0.3-schema.md` open follow-ups.
- ⏳ **`ReclamationEvent` dispute-window timer.** Same — seed has rows
  in both lifecycle states; the cron handler that flips them lands later.
- ⏳ **Sign off** on ADR 0002 (cost-centre key). Parked pending FinOps
  conversation on the allowlist.
- ⏳ **Cost-centre allowlist** (FinOps-owned). The blocking external
  decision for ADR 0002 — `docs/decisions/0002-cost-centre-key.md`
  open follow-ups.

### Hosting / production (scoping §6 Q3)

Target shape pinned by ADR 0003 (`docs/decisions/0003-deploy-target.md`).
Step-by-step in **`docs/deploy/azure.md`**; sample bootstrap script and
sample GitHub Actions workflow live alongside it.

**v0.2 preview is live**:
<https://wdts-ai-program-console.azurewebsites.net/>. Authentication
end-to-end against the WDTS Entra tenant verified on 2026-04-28. The
preview shape has two intentional deviations from LDR 0003 (Key Vault
in access-policy mode, Postgres with public access + firewall rules);
both are documented in `docs/deploy/azure.md` §7 and exposed as
`KV_AUTH_MODE` / `PG_PUBLIC_ACCESS` flags in `azure-bootstrap.sh`.

Tier-0 unblocks status:

- ✅ **WDTS-corp Azure subscription + resource group**: subscription
  `WDTS-Brinda` (`85e4ac4b-905f-4ee5-a003-e4887facc0f3`),
  RG `wdts-ai-program-console-rg`. Operator role: Contributor (which
  is why the preview uses access-policy mode for Key Vault).
- ✅ **Region** — `centralindia`.
- ✅ **Production Microsoft Entra ID app registration** —
  `wdts-ai-program-console (prod)`, separate from the dev/sandbox.
  Groups claim configured. `User.Read.All` + `Reports.Read.All`
  admin-consented. Secrets live in Key Vault (`wdts-ai-cons-kv`).
- ⏳ **Custom domain** — `*.azurewebsites.net` works for the preview
  but trips Chrome Safe Browsing on the OAuth path
  (`/api/auth/signin/microsoft-entra-id`). Custom domain + TLS is the
  v0.3 fix; until then, the sign-in UX requires a one-time "Hide
  details → this unsafe site" bypass per browser profile.
- ⏳ **GitHub `production` environment** with at least one required
  reviewer and `main`-only branch policy. Promotion of
  `docs/deploy/deploy.yml.sample` → `.github/workflows/deploy.yml`
  is still gated on this. Until then, deploys are zip-deploy from
  the operator's laptop.
- ⏳ **VNet integration + private endpoint for Postgres** — the LDR
  0003 target. The preview is closed-over-HTTPS but not
  network-isolated. Tracked under v0.3 hardening.
- ⏳ **Key Vault RBAC mode** — needs Owner / User Access Administrator
  on the vault scope, which the operator does not currently hold.
  Defer until either the role is granted or the v0.3 prod-target
  shape is provisioned by an ITAdmin.

### Credential hygiene

- ⚠ **`AZURE_AD_CLIENT_SECRET` and `AZURE_OPENAI_API_KEY`** were pasted
  into a Cursor agent chat on 2026-04-28 and exist in this machine's
  agent-transcript JSONL on disk. Rotation deferred by user decision;
  triggers for forced rotation are documented in the banner at the top
  of `.env.local`.

---

## 14. Future scope (parked, do NOT start without trigger)

Things explicitly considered and intentionally deferred. Each entry has a
**trigger** that must fire before the agent picks the work up. Listed here
so they're not forgotten in chat backscroll.

| Topic | Trigger | Pointer |
|---|---|---|
| **AAD security-group → Role binding** | Org grows past the AI Task Force scope and dashboard access becomes IT-owned with separate audit posture. | LDR 0005 §"Open follow-ups". The plan: optional `Role.aadGroupId` column + JWT-callback group walk. Unstarted. |
| **Ownership transfer flow** | A second owner is needed (e.g. CTO transition). | LDR 0005 §"Open follow-ups". v0.4 admin action; current row → new row, atomic. |
| **Service accounts / API tokens** | First M2M consumer of dashboard data (e.g. external dashboard, scheduled report runner). | LDR 0005 §"Open follow-ups". Out of scope for v0.4; v0.5 design with HMAC-signed tokens. |
| **Partial unique index on `User.isOwner`** | We see the second-owner foot-gun in practice. | LDR 0005 §"Open follow-ups". Manual SQL migration. |
