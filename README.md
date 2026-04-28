# WDTS AI Program Console — v0.1 prototype

A working Next.js prototype dashboard for WDTS's AI Guardrails program. v0.1 is a
read-only operator console that surfaces program-level state across the five
approved AI products — **Cursor / ChatGPT / Codex / Claude.ai / M365 Copilot** —
populated entirely by deterministic synthetic data so it can be run, demoed, and
iterated on without any real vendor integrations. See
`Dashboard_Scoping_v1.md` (in the sibling `ai-guardrails-pass/` folder) for the
full v1 brief; this build implements the v0.1 cut described there.

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
│  │  ├─ cursor-seats/page.tsx   # F4 — 84-seat board + waitlist
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
- **F4 — Cursor Seats** (`/cursor-seats`): the 84 seats rendered as three rows
  (17 Power purple / 42 Standard blue / 25 Light grey). Each filled cell shows
  initials and tooltips with full name, idle days, MTD spend vs cap. Idle ≥14d
  cells get an amber ring; ≥30d a rose ring. Below: a synthetic 8-row waitlist.
- **F5 — Decisions** (`/decisions`): append-only ledger with type chips and
  date-range chips at the top, plus a CSV export button that hits
  `/api/decisions/export` and respects the current filters.
- **Settings** (`/settings`): stub.

---

## v0.1 known limitations

This is a proof-of-concept. The following are **deliberately stubbed**:

- **Auth**: `lib/auth.ts` returns a hardcoded `admin@wdts.com` dev user. No
  session, no SSO, no role-based access control. v0.2 wires NextAuth + Azure
  AD per scoping §6 Q2.
- **All vendor integrations**: there is no gateway / Cursor admin / OpenAI admin
  / Anthropic admin / Microsoft Graph client. All data comes from
  `lib/synthetic-data.ts` + `prisma/seed.ts`. v0.2 swaps in the
  `synthetic|real` integration pattern from scoping §4.
- **Write actions** (F6–F8): no tier promotion / demotion, no reclamation
  workflow, no exception flow. The scoping doc puts the write path in v1.1.
- **Decision log immutability**: enforced by convention only. v0.2 adds
  trigger-level row immutability and nightly export to a WORM Azure Blob.
- **Per-manager queue** (F3): not implemented in v0.1.
- **Anomaly detection / Friction Budget KPIs / Copilot rationalisation**
  (F11–F15): out of scope for v0.1.
- **Tests**: none. v0.2 lands the Vitest / Playwright suites described in
  scoping §9.2.
- **Azure deployment / CI**: local-only.

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

## v0.2 follow-ups

In rough priority order; the first three are the immediate next slice.

1. **Wire Azure AD via NextAuth** (scoping §4 integration #1, §6 Q2). Replace
   `lib/auth.ts` with `getServerSession()`. Add a `.cursor/rules/auth.mdc`
   enforcing 401 on missing session for every route handler.
2. **F3 — Per-manager queue**. Each manager sees their direct reports' cap
   utilisation, idle days, and any pending tier-move recommendations. Source:
   the existing `User.managerId` column + gateway aggregates.
3. **Synthetic-vs-real integration interfaces**. Stand up
   `src/integrations/<gateway|cursor|openai|anthropic|m365graph|deel>/{types,synthetic,real}.ts`
   per scoping §4. Drive selection by `INTEGRATION_<NAME>=synthetic|real` env
   vars. Re-implement `lib/synthetic-data.ts` as the `synthetic` impl of each.
4. **Write path (F6–F8)**: tier promotion/demotion via policy-repo PR (GitHub
   API), reclamation flow with 5-business-day dispute window, exception flow
   (§16.3) with manager attestation → FinOps → Steering routing.
5. **Decision log hardening**: trigger-level row immutability, nightly WORM
   export, evidence-link validation.
6. **F9 — Codex ladder** visualisation. Promotion / demotion queues, dormancy
   events, mirroring §4.6.2.
7. **F10 — Overage / chargeback** view per team / per cost-centre.
8. **F11 — Friction Budget KPI panel** (scoping §17.5) with auto-rollback
   indicators.
9. **F13 — M365 Copilot rationalisation review module** (cross-references
   telemetry + survey + Deel role tag).
10. **Production hardening**: Vitest + Playwright suites, GitHub Actions CI to
    Azure App Service / Container Apps, Front Door + Key Vault wiring, ADR doc
    set, `AGENTS.md` + `.cursor/rules/` per scoping §9.

---

## Notes for future agents

- The schema lives in `prisma/schema.prisma`. v0.1 keeps a deliberately small
  subset (User / License / UsageRecord / Decision). The full schema in scoping
  §3.1 has six more models.
- All four pages fetch directly from Prisma in Server Components. There are no
  API routes for v0.1 except the CSV export.
- `lib/synthetic-data.ts` uses a deterministic mulberry32 PRNG so re-running
  `prisma db seed` always produces the same data — useful for screenshots and
  demo scripts.
- The seed clears all rows before re-inserting; safe to run repeatedly.
