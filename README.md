# WDTS AI Program Console — v0.3

A Next.js operator dashboard for WDTS's AI Guardrails program, surfacing
program-level state across the five approved AI products — **Cursor /
ChatGPT / Codex / Claude.ai / M365 Copilot** — to FinOps, Engineering Mgmt,
Security, and Steering.

v0.3 lands:

- **App-level RBAC** — `Role` table + `User.dashboardRoleId`,
  built-in roles (USER / MANAGER / FINOPS / ADMIN) seeded from code,
  custom roles created via `/settings/roles`. Admin UI at
  `/settings/users` for invite + role + enable/disable. AAD provides
  identity only; the dashboard owns its access policy. See LDR 0005.
- **Closed-by-default sign-in** — only invited emails (in the
  `User` table) can sign in. Everyone else lands on a friendly
  `/access-denied` page. The owner invites people from
  `/settings/users → Invite user`.
- **Auth** — Auth.js v5 with Microsoft Entra ID, JWT carries role +
  permissions array.
- **v0.3 schema** — four new authoritative / snapshot models
  (`ExceptionRequest`, `ReclamationEvent`, `BudgetSnapshot`,
  `FrictionBudgetMetric`) and ten Postgres enums lifted from previously
  string-typed columns (`UserStatus`, `Product`, `LicenseSource`,
  `UsageDecision`, `DecisionType`, plus the five new ones). Migration
  preserves data through in-place enum casts. See LDR 0001.
- **All vendor integrations** — `cursor` (SCIM 2.0), `openai`, `anthropic`
  (admin APIs), `m365graph` (Copilot reports — flipped to `real` in
  prod 2026-04-29), `azuread` (also `real` in prod), `deel`,
  `policyrepo` (write path) all have working `real.ts` implementations
  with mocked-fetch contract tests. `gateway` stays synthetic (vendor
  TBD per Phase 0).
- **Identity reconciler** — `npm run reconcile:azuread` mirrors Graph
  users into Prisma, wraps each pass in a `Decision` row.
- **Webhooks** — `/api/webhooks/deel` HMAC-verifies + records advisory
  Decisions.
- **CI** — GitHub Actions runs `typecheck + lint + 152 tests` on every
  PR + push to `main`.
- **F3 / F9 / F10** — manager queue, Codex ladder, per-team chargeback
  views landed.

What lights it up: each integration's runtime needs an external
unblock — see [`AGENTS.md` §13 "Open blockers"](./AGENTS.md#13-open-blockers-operational)
for the canonical list. The dashboard runs end-to-end against synthetic
data with zero vendor credentials.

See `Dashboard_Scoping_v1.md` (sibling `ai-guardrails-pass/` folder) for
the full v1 brief, and `docs/decisions/` for in-flight architecture
proposals.

---

## Setup

### Prerequisites

- **Node.js 20+** (tested on 25.x).
- **Docker Desktop installed and running** (or any Docker daemon — Colima / OrbStack are fine).
- macOS or Linux (Windows via WSL2 should work but is untested).

### Run order

```bash
# 1. clone (or already cloned), then:
cd /Users/anujgoyal/Code/wdts-ai-program-console
npm install

# 2. start Postgres
docker compose up -d

# 3. apply schema migrations and seed deterministic synthetic data
npx prisma migrate deploy   # applies prisma/migrations/* on a fresh DB
npx prisma db seed

# 4. run the dev server
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/health`.

The dev top bar shows a stubbed dev-mode user (`admin@wdts.com (DEV)`); see "v0.1
known limitations" below for what's stubbed.

### Stop / reset

```bash
# stop the postgres container (data persists in the named volume)
docker compose down

# nuke the data and start fresh
docker compose down -v
docker compose up -d
npx prisma migrate deploy
npx prisma db seed
```

There's also a one-shot reset:

```bash
npm run db:reset      # prisma migrate reset --force (drops DB, re-applies migrations, re-seeds)
```

### Schema changes

v0.2 onwards uses Prisma migrations as the canonical workflow — `prisma db push`
is for prototype iteration only. To change the schema:

```bash
# 1. edit prisma/schema.prisma
# 2. generate + apply the migration
npm run db:migrate -- --name <short_intent>
# 3. update prisma/seed.ts so it exercises the new shape
# 4. open a PR; never push schema changes directly to main
```

See `.cursor/rules/prisma-changes.mdc` for the full discipline.

### Tests

```bash
npm test               # run the full suite (unit + DB-integration)
npm run test:watch     # watch mode for the test you're iterating on
npm run db:test:setup  # one-shot: provision the test DB (idempotent)
```

Tests come in two flavours:

- **Unit / pure tests** in `**/*.test.ts` — no DB, no network.
- **DB-integration tests** in `**/*.db.test.ts` — connect to a separate
  Postgres database (`<dev-db-name>_test`) that's auto-created and seeded
  with the deterministic fixture every test run. Read-only.

Vitest's `globalSetup` (in `tests/global-setup.ts`) handles the test DB
provisioning automatically, so `npm test` works on a freshly-cloned repo
without any extra steps. See `AGENTS.md` §7 for the full discipline.

### Postgres outside Docker?

If you don't want Docker, install Postgres 16 natively and point `DATABASE_URL`
at it:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb wdts_ai_console
# then edit .env if your user / password / port differ
```

Then run `npx prisma migrate deploy && npx prisma db seed && npm run dev` as usual.

---

## Project structure

```
wdts-ai-program-console/
├─ app/
│  ├─ (dashboard)/               # routed group; shared sidebar + topbar layout
│  │  ├─ layout.tsx              # sidebar + main shell
│  │  ├─ health/page.tsx         # F1 — Program Health
│  │  ├─ users/page.tsx          # F2 — Per-User view
│  │  ├─ cursor-seats/page.tsx   # F4 — 120-seat board (4 sub-tiers) + waitlist
│  │  ├─ decisions/page.tsx      # F5 — append-only decision ledger
│  │  └─ settings/page.tsx       # stub
│  ├─ api/
│  │  └─ decisions/export/route.ts   # CSV export for F5
│  ├─ layout.tsx                 # html shell
│  ├─ page.tsx                   # redirects → /health
│  └─ globals.css                # tailwind v4 entry
├─ components/
│  ├─ ui/                        # local shadcn-style primitives (card / badge / button / input / table)
│  ├─ charts/                    # spend-trend chart, budget bar
│  └─ dashboard/                 # sidebar, topbar
├─ lib/
│  ├─ prisma.ts                  # singleton Prisma client
│  ├─ auth.ts                    # STUB — hardcoded dev user; v0.2 wires Azure AD via NextAuth
│  ├─ program.ts                 # program constants (budgets, tiers, seat quotas)
│  ├─ synthetic-data.ts          # STUB — deterministic synthetic data generator (replaced by real clients in v0.2)
│  └─ utils.ts                   # cn(), formatUsd(), initials()
├─ prisma/
│  ├─ schema.prisma              # User / License / UsageRecord / Decision
│  └─ seed.ts                    # deterministic 30-user seed (run via `prisma db seed`)
├─ docker-compose.yml            # Postgres 16-alpine, port 5432, named volume
├─ .env                          # DATABASE_URL — local dev only
└─ package.json
```

### Pages — what each one does

- **F1 — Program Health** (`/health`): one combined ChatGPT + Codex cap card
  ($150K/mo), then 5 per-product budget cards across the top, then a stacked
  area chart of daily spend across the last 30 days, then a Top-10-spenders
  table. Mirrors the answer-the-question-in-60-seconds bar in scoping §8.
- **F2 — Users** (`/users`): search input across name / email / role tag; left
  rail of matches; right pane with the selected user's tier in each of the 5
  products, MTD + projected EOM spend, and the last 25 usage records. Macau
  (`apac-mo`) users get a §3.3 jurisdictional callout.
- **F4 — Cursor Seats** (`/cursor-seats`): the 120 seats rendered as four rows
  (17 Power purple / 42 Standard blue / 25 Light grey / 36 Discovery stone),
  matching the §4.6.1 sub-tier shape (v2.0+, current at v2.3). Each filled cell shows initials and
  tooltips with full name, idle days, MTD spend vs cap. Idle ≥14d cells get an
  amber ring; ≥30d a rose ring. The header callout reframes the page around
  the $500K/yr **credit envelope** as the binding constraint (Cursor confirmed
  in April 2026 that licenses are uncapped within that envelope), with the
  120-seat shape as WDTS's allocation plan inside it. Below: a synthetic
  8-row waitlist.
- **F5 — Decisions** (`/decisions`): append-only ledger with type chips and
  date-range chips at the top, plus a CSV export button that hits
  `/api/decisions/export` and respects the current filters.
- **Settings** (`/settings`): stub.

---

## v0.3 known limitations

The dashboard runs end-to-end against synthetic data with zero vendor
credentials. The following are **operationally blocked** (need an external
action to flip on, not a code change):

- **Vendor real-mode flips**. Each `INTEGRATION_*=real` requires its
  vendor credentials (`OPENAI_ADMIN_API_KEY`, `ANTHROPIC_ADMIN_API_KEY`,
  `CURSOR_SCIM_BASE_URL` + `CURSOR_ADMIN_TOKEN`, `DEEL_API_TOKEN`,
  `POLICYREPO_*`, etc.) plus admin consent on the AAD app reg for
  `Reports.Read.All`. See `AGENTS.md` §13.
- **Policy repo PAT**. The repo itself exists at
  https://github.com/agoyalwdts/wdts-ai-policy and is wired into
  `.env.local`; still needs branch protection enabled + a fine-grained
  PAT (`contents:write` + `pull_requests:write`) before
  `INTEGRATION_POLICYREPO=real` is safe to flip.
- **Write actions (F6–F8)**. The data plane (Decision row + policy-repo
  PR) is plumbed; the UI surfaces (tier promotion, reclamation, exception
  flow) land per scoping §2 v1.1.
- **Decision log immutability**: enforced by convention. Trigger-level
  row immutability + WORM export deferred per scoping §3.3.
- **Anomaly detection / Friction Budget KPIs / Copilot rationalisation**
  (F11–F15): out of scope for v0.2.
- **Cost-centre key**: proposed in ADR 0002 — needs FinOps sign-off on
  the canonical key shape + the allowlist.
- **Playwright e2e**: scoping §9.2 lists Playwright as part of the test
  pyramid; not yet wired. Vitest suite covers unit + DB-integration +
  mocked-API-route paths.
- **Azure deployment**: still local + CI only.

### Workarounds taken during the build

- **Pinned Prisma to v6**. Prisma 7 requires moving the datasource URL out of
  `schema.prisma` into a `prisma.config.ts` adapter file. Pinning to v6 keeps
  the schema syntax matching the scoping doc and unblocks v0.1. Revisit on the
  v0.2 hardening pass.
- **Inline `components/ui/*` instead of `npx shadcn add`**. The shadcn CLI was
  hanging on a registry-auth prompt in non-interactive mode; for a v0.1
  prototype it's faster to ship the small set of primitives we need (Card,
  Button, Badge, Input, Table) directly using Radix + Tailwind. The components
  follow shadcn conventions and can be regenerated with the CLI later.
- **Docker prerequisite stated, not auto-installed**. The build agent does not
  have permission to install Docker Desktop; the run order assumes the user
  starts the Postgres container themselves.

---

## v0.4 follow-ups

In rough priority order:

1. **ADR 0002** — canonical `User.costCentre` key. Needs FinOps sign-off
   on the allowlist + clarification on Deel's storage of cost centres.
   ADR 0001 (v0.3 schema additions) accepted + landed on 2026-04-29 in
   migration `20260429_v0_3_schema`.
2. **Operational unblocks** in `AGENTS.md` §13: vendor admin tokens,
   branch protection + PAT on the `agoyalwdts/wdts-ai-policy` repo.
3. **Write path (F6–F8)**: tier promotion / demotion via policy-repo PR
   (the client is wired); reclamation flow with 5-business-day dispute
   window; exception flow (§16.3) with manager attestation → FinOps →
   Steering routing.
4. **Reconciler scheduling**: nightly cron for `npm run reconcile:azuread`
   (and a parallel Deel reconciler that consumes the webhook
   advisory-Decision feed).
5. **Manager hierarchy reconciliation**: `azuread` reconciler currently
   skips `managerId` (would be N+1 on Graph). Add a `$expand=manager`
   pass.
6. **Money column types**: `Float` → `Decimal` per ADR-0001 follow-ups.
7. **Decision log hardening**: trigger-level row immutability, nightly
   WORM export.
8. **F11 — Friction Budget KPI panel** (scoping §17.5).
9. **F13 — M365 Copilot rationalisation review** (the data is now
   reachable via the m365graph real client).
10. **Playwright e2e** for the F-feature flows.
11. **Production hardening**: Azure App Service + Postgres Flexible
    Server + Key Vault + GitHub Actions OIDC. Pinned by
    `docs/decisions/0003-deploy-target.md`; step-by-step in
    [`docs/deploy/azure.md`](docs/deploy/azure.md). Custom domain and
    Front Door / WAF stay as later follow-ups.

---

## Notes for future agents

- The schema lives in `prisma/schema.prisma`. v0.3 carries
  `User / Role / License / UsageRecord / Decision / ExceptionRequest /
  ReclamationEvent / BudgetSnapshot / FrictionBudgetMetric` plus ten
  Postgres enums. The migration that lands the four v0.3 models also
  lifts the previously-string columns to enums in-place. See LDR 0001.
- All four pages fetch directly from Prisma in Server Components. There are no
  API routes for v0.1 except the CSV export.
- `lib/synthetic-data.ts` uses a deterministic mulberry32 PRNG so re-running
  `prisma db seed` always produces the same data — useful for screenshots and
  demo scripts.
- The seed clears all rows before re-inserting; safe to run repeatedly.
