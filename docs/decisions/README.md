# Architecture / program decisions

This folder is the dashboard's **lightweight decision record (LDR) log**. Each
file captures a decision that meaningfully shapes the dashboard's data model,
its integration surface, or the policy it enforces. They are intentionally
short — no formal MADR / ADR template — but they do follow a fixed shape so
they're scannable.

## Where this fits

These records cover **how the dashboard is built**. They do **not** replace
the runtime `Decision` table — that one captures _operational_ decisions
(tier moves, exceptions, reclamations) made via the dashboard. Both exist;
they don't overlap.

| | Files in this folder | `Decision` table |
|---|---|---|
| Scope | How the dashboard works | What the dashboard authorised |
| Authority | Engineering (this repo) | The program (FinOps, Steering, Eng Mgmt) |
| Audience | Future agents + reviewers | Auditors + the policy repo |
| Lifetime | Permanent record of the choice | Append-only operational ledger |
| Cadence | Rarely (1–2 per quarter) | Every operational write |

## Format

Each file is `NNNN-short-slug.md` and has these sections:

- **Status** — `proposed` / `accepted` / `superseded by NNNN`. New records start `proposed` and flip to `accepted` only after a human signs off.
- **Context** — what changed in the program / scope that forced the question.
- **Decision** — the choice itself, written as a single declarative sentence.
- **Rationale** — why this beats the alternatives.
- **Alternatives considered** — every option that was on the table, with the reason it lost.
- **Consequences** — what code / process / policy is now bound by this choice.
- **Open follow-ups** — things this record doesn't decide and that still need a human.

## Sign-off discipline

A `proposed` record is **not** a green light to start coding against it. The
agent can _draft_ the record and the migrations / clients implied by it on
a feature branch, but the human flips `Status: proposed` → `Status: accepted`
in the same PR that lands the implementation. If the implementation reveals
the proposal was wrong, the agent edits the record (still `proposed`) and
re-asks.

## Index

| # | Title | Status |
|---|---|---|
| 0001 | v0.3 schema additions: ExceptionRequest, ReclamationEvent, BudgetSnapshot, FrictionBudgetMetric | proposed |
| 0002 | Canonical cost-centre key on User | proposed |
| 0003 | Production deploy target: Azure App Service + Postgres FS + Key Vault + GHA OIDC | accepted |
| 0004 | Cursor is credit-bound, not seat-bound: 4 sub-tiers, 120-seat plan inside a $500K/yr envelope | accepted |
