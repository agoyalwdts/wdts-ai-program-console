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
5. The most recent `Decision` row in the dev DB (it tells you what the previous
   session decided, in case it predates a commit):
   ```bash
   PGPASSWORD=wdts_dev psql -h localhost -p 5432 -U wdts -d wdts_ai_console \
     -c 'SELECT ts, type, justification FROM "Decision" ORDER BY ts DESC LIMIT 5;'
   ```
6. `git log --oneline -20` and `gh pr list --state open` to see what's in flight.

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

- The policy repo `codex-policies/` (separate repo; not in this build yet).
- The IdP — Azure AD / Entra ID.
- The gateway audit log (vendor TBD per scoping §8 N-series).

The dashboard owns authoritatively only `Decision`, `ExceptionRequest`, and
`ReclamationEvent` rows, and those are append-only and exported nightly to a
WORM Azure Blob (v0.2+). If the dashboard is wiped, the program continues; the
dashboard is rebuilt from the policy repo + audit log.

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

# 3) apply schema + deterministic synthetic seed
npx prisma db push
npx prisma db seed

# 4) dev server
npm run dev          # http://localhost:3000 → redirects to /health

# one-shot reset
npm run db:reset     # prisma db push --force-reset && prisma db seed
```

---

## 6. Project structure

```
wdts-ai-program-console/
├─ app/
│  ├─ (dashboard)/
│  │  ├─ layout.tsx              # sidebar + topbar shell
│  │  ├─ health/page.tsx         # F1 — Program Health
│  │  ├─ users/page.tsx          # F2 — Per-User
│  │  ├─ cursor-seats/page.tsx   # F4 — 84-seat board + waitlist
│  │  ├─ decisions/page.tsx      # F5 — append-only ledger
│  │  └─ settings/page.tsx       # stub
│  ├─ api/decisions/export/route.ts   # CSV export for F5
│  ├─ layout.tsx                 # html shell
│  └─ page.tsx                   # redirects → /health
├─ components/
│  ├─ ui/         # local shadcn-style primitives (Card / Badge / Button / Input / Table)
│  ├─ charts/     # SpendTrendChart, BudgetBar
│  └─ dashboard/  # Sidebar, Topbar
├─ lib/
│  ├─ prisma.ts             # singleton client
│  ├─ auth.ts               # STUB — replace with NextAuth in v0.2
│  ├─ program.ts            # program constants
│  ├─ synthetic-data.ts     # STUB — synthetic generator (v0.2 swaps in real clients)
│  └─ utils.ts              # cn(), formatUsd(), initials()
├─ prisma/
│  ├─ schema.prisma         # User / License / UsageRecord / Decision (v0.1 subset)
│  └─ seed.ts               # deterministic 30-user seed
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

---

## 7. Test discipline

- **v0.1: no tests.** Deliberate. The build was time-boxed to a working demo.
- **v0.2 lands the test suite** per scoping §9.2:
  - **Vitest** for unit tests on every utility and pure function in `lib/`.
  - **Vitest + a fetch wrapper** for API route handlers
    (`app/api/**/route.ts`).
  - **Playwright** end-to-end against the synthetic-data dev environment for
    each F-feature flow.
  - **No feature ships without tests passing in CI.**

When you add the first test, also add a `test` script in `package.json` and a
GitHub Actions workflow to run it on PRs.

---

## 8. Commit and PR discipline

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`).
- **Small commits** — aim for 30–80 lines of net-new code per commit. One
  logical change per commit.
- **PRs for every feature.** PR description includes:
  - which F-number from scoping §2 this implements,
  - what was added/changed,
  - what tests were added (once we have tests),
  - any open question for the human reviewer.
- **No direct pushes to `main`** once `main` branch protection is on. The
  agent never bypasses review.
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
| Auth | NextAuth + Azure AD wiring; replace `lib/auth.ts`; enforce 401 on routes | §4 #1, §6 Q2, §8 N2 |
| F3 Manager queue | Per-manager direct-reports view (cap %, idle, pending tier moves) | §2 v1 row 3 |
| Integration interfaces | `src/integrations/<gateway\|cursor\|openai\|anthropic\|m365graph\|deel\|policyrepo>/{types,synthetic,real}.ts` driven by `INTEGRATION_*=synthetic\|real` env vars | §4 |
| F6 Tier promotion / demotion | Write-path via policy-repo PR (GitHub API), SCIM update flow | §2 v1.1 row 1 |
| F7 Reclamation + dispute | 5-business-day dispute window, trigger UI, notifications | §2 v1.1 row 2 |
| F8 Exception flow | §16.3 manager attestation → FinOps → Steering routing, 30-day TTL | §2 v1.1 row 3 |
| F9 Codex ladder | Power/Standard/Light/Discovery promotion + demotion + dormancy view | §2 v1.1 row 4 |
| F10 Overage / chargeback | Per-team / per-cost-centre monthly view | §2 v1.1 row 5 |
| F11 Friction Budget KPIs | §17.5 weekly metrics + auto-rollback indicator | §2 v1.2 row 1 |
| F12 Anomaly detection | Outlier spend, sudden cap exhaustion, unusual model usage | §2 v1.2 row 2 |
| F13 Copilot rationalisation | Telemetry + survey + Deel role tag cross-reference | §2 v1.2 row 3 |
| F14 Bypass-mechanism alerts | §11.6 — `--dangerously-bypass`, `approval_policy="never"`, Cursor Auto-Run | §2 v1.2 row 4 |
| F15 Shadow-AI signals | Network egress to un-allowlisted AI endpoints | §2 v1.2 row 5 |
| Schema gaps | `ExceptionRequest`, `ReclamationEvent`, `BudgetSnapshot`, `FrictionBudgetMetric` rows + the §3.2 SQL views | §3.1 |
| Decision-log hardening | Trigger-level row immutability + nightly WORM export to Azure Blob | §3.3 |
| Hosting | Azure App Service / Container Apps + Postgres Flexible Server + Key Vault + Front Door + GH Actions CI | §6 Q3 |
| Tests + CI | Vitest unit + Vitest API + Playwright e2e + GH Actions | §9.2 |
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
- **N6** — Deel API access + webhook endpoint.
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
