# WDTS AI Program Console — Policy Brief

**Document type:** Internal policy alignment brief (dashboard + operating model)  
**Audience:** Security, FinOps, Engineering Management, Steering  
**Status:** Working draft for executive review — not a substitute for the canonical policy repository  
**Related:** `AGENTS.md`, `docs/decisions/`, `lib/program.ts`, `README.md`

---

## 1. Purpose

This brief describes **what the AI Program Console is for**, **what it does not replace**, and **what we are asking the organization to endorse** so the program can run with clear accountability, auditable decisions, and predictable cost posture across the **five approved AI products**: Cursor, ChatGPT, Codex (OpenAI Enterprise), Claude.ai, and Microsoft 365 Copilot.

---

## 2. Strategic posture (authoritative vs operational)

| Domain | Authoritative source | Role of the console |
|--------|----------------------|---------------------|
| License footprint, tier rules, guardrails text | **Policy repository** (`wdts-ai-policy`) — changes via controlled PR workflow | Dashboard reads posture; **writes** to policy go through the same PR path, not ad hoc vendor toggles |
| Identity (who someone is, MFA, joiner/leaver) | **Microsoft Entra ID** | Console uses Entra for **sign-in only**; **authorization** (who may use the dashboard and what they can do) is **owned by the application** (roles, invites, disable flags) |
| Prompt/response content, full gateway logs | **Gateway / vendor** (retention under vendor and security policy) | Console stores **metadata only** (e.g. usage aggregates, decisions) — no prompt bodies |
| Operational ledger (decisions, future: exceptions, reclamation) | **Dashboard database** (`Decision`, and planned models per LDR 0001) | Append-style record of **what was decided** and **why**; exportable for audit |

**Forbidden moves (program discipline):** no direct writes to vendor admin APIs for policy changes; no bypassing authentication for operator routes; no storage of DLP secrets in plain text; no expansion of approved vendors without explicit review.

---

## 3. What the console proposes to change

**From:** Fragmented visibility (spreadsheets, vendor UIs, informal updates) and weak linkage between **money**, **seats**, and **policy**.

**To:** A single **read-heavy operator surface** that:

1. **Unifies program health** — Budget and usage views aligned to agreed envelopes (Cursor credit envelope, OpenAI pooled credits + license baseline + overage planning, Copilot prepaid commit, Claude placeholder as contracted).
2. **Uses vendor truth where it matters** — When integrations are live, key tiles (e.g. Cursor spend from Team Admin usage API, OpenAI org costs, Copilot Graph reports) **reconcile** to vendor dashboards; gateway mirror fills gaps for governed inference where configured.
3. **Separates identity from authorization** — Entra proves identity; the dashboard enforces **closed-by-default access** (invite-only users) and **role-based permissions** (USER / MANAGER / FINOPS / ADMIN and custom roles).
4. **Prepares controlled write paths** — Tier moves, reclamation, and exceptions are **scoped for future delivery** via policy-repo PRs and in-app workflows, each wrapped in decision logging (per program standards).

---

## 4. Governance and access policy (application-owned)

- **Sign-in:** Only identities that have a corresponding allowed user record (or break-glass bootstrap rule) may sign in; others receive access denied.
- **Roles:** Permissions are defined in product and stored in the database; JWT carries a resolved permission set for the session.
- **Audit:** Sensitive exports and privileged actions are permission-gated; significant automated actions (e.g. identity reconcile, vendor spend sync) are logged to the decision ledger where implemented.

*Note: Optional future binding to Entra security groups for roles is explicitly out of scope unless triggered by a separate decision.*

---

## 5. Financial and capacity posture (illustrative constants)

Program numbers displayed on Program Health are **pinned in code** (`lib/program.ts`) and should be **kept in sync** with the policy repo and contracts. Examples reflected in the product today:

- **Cursor:** Annual credit envelope (e.g. $500K/yr planning band) with operational display tied to **vendor-reported spend** when sync is enabled.
- **ChatGPT + Codex:** Entitled seat count, pooled credits per seat per month, license baseline per seat, and overage rate — combined planning envelope for F1.
- **M365 Copilot:** EA-style **prepaid** annual commit, levelized monthly for planning — not usage-metered like API pools.
- **Claude.ai:** Placeholder envelope until contract is finalized.

FinOps and Steering should treat **`lib/program.ts` + policy repo** as the pair to reconcile before any external communication of “official” numbers.

---

## 6. Data handling and integrations

- **Synthetic mode:** Development and demos run without live vendor credentials.
- **Real mode:** Per-integration toggles; each requires operational secrets and (where applicable) admin consent. See `AGENTS.md` open blockers for production readiness.
- **Gateway mirror:** Usage events may be ingested via HMAC webhooks into `UsageRecord`; guidelines live in `docs/gateway-and-litellm.md`.
- **Vendor daily spend:** Parallel path for vendor-accurate USD (e.g. Cursor filtered usage events summed into daily buckets) stored in `VendorDailySpend` and merged into Program Health when present.

---

## 7. Roadmap themes (proposal framing)

| Theme | Intent |
|-------|--------|
| **Hardening** | Custom domain, network isolation, Key Vault RBAC, automated deploy promotion |
| **Workflows** | Tier promotion/demotion, reclamation with dispute window, exception requests — all tied to policy PRs + ledger |
| **Observability** | Friction budget KPIs, anomaly signals, Copilot rationalisation, bypass-pattern alerts (per program backlog) |
| **Data model** | Materialized snapshots, reclamation timers, cost-centre key sign-off (see `docs/decisions/` proposed records) |

---

## 8. Decisions requested from leadership

1. **Endorse** the split of responsibilities in Section 2 (especially: dashboard owns access control; policy repo owns guardrail text and inventory).
2. **Confirm** FinOps ownership of **program number** updates (policy repo + `lib/program.ts` alignment) and communication cadence to Steering.
3. **Prioritize** roadmap themes in Section 7 for the next two quarters (security hardening vs workflow vs analytics).
4. **Name** approvers for production promotion (GitHub environment, deploy workflow) and for any **write path** that touches customer-facing policy.

---

## 9. Document control

- **Owner:** Program / Engineering (tbd by Steering)  
- **Review cycle:** After major contract or policy repo release  
- **Canonical policy:** `agoyalwdts/wdts-ai-policy` — this brief is a **dashboard program** companion, not the license document of record.
