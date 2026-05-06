# Executive deck — AI Program Console (slide copy)

Use this file as **copy/paste source** for PowerPoint or Google Slides.  
Suggested theme: 16:9, ~12 slides, minimal text per slide.

---

## Slide 1 — Title

**WDTS AI Program Console**  
*One place to see cost, seats, and guardrail-program health*

Subtitle: Briefing for Steering / Security / FinOps  
Date: [insert]

---

## Slide 2 — Why this matters

**Generative AI is now a line item and an operational risk**

- Multiple **approved vendors** — each with its own admin UI and billing shape  
- **Money, seats, and policy** drift apart without a shared operating picture  
- Leadership needs **one trusted view** aligned to **our** policy, not the vendor’s homepage

**We are proposing:** a governed **internal console** — not a new source of truth for policy text, but the **operational cockpit** for the program.

---

## Slide 3 — The problem today

**Fragmentation**

- Hard to answer: *“Are we on budget this month?”* across Cursor, OpenAI, Copilot, Claude  
- **Vendor dashboards** don’t encode WDTS planning envelopes (pooled credits, prepaid commit, credit caps)  
- **Access** to tools is not the same as **visibility** for FinOps and Steering

---

## Slide 4 — What we are building (one sentence)

**A secure, invite-only dashboard** that shows **program-level health** for the **five approved AI products** and ties numbers to **agreed** budgets and contracts.

Products on the roadmap surface: **Cursor · ChatGPT · Codex · Claude.ai · M365 Copilot**

---

## Slide 5 — What “good” looks like

**Program Health (F1)**

- **Planning envelopes** — Cursor credit band, OpenAI pooled credits + license + overage planning, Copilot prepaid commit  
- **Month-to-date** — where integrations are live, **reconciled to vendor APIs** (e.g. Cursor Team Admin usage, OpenAI org costs, Copilot Graph)  
- **Transparency** — same definitions Finance and Engineering use in planning

---

## Slide 6 — Governance model (critical)

**We are not replacing the policy handbook**

| Owns the rulebook & inventory | Owns identity | Owns who can use *this* dashboard |
|------------------------------|---------------|-----------------------------------|
| **Policy repo** (Git PRs) | **Microsoft Entra ID** | **AI Program Console** (roles, invites) |

- **Closed by default:** only invited users can sign in  
- **Roles:** FinOps, managers, admins — permission-gated actions  
- **No prompt storage** in the console — metadata and aggregates only

---

## Slide 7 — Financial posture (executive snapshot)

**Illustrative program lines (aligned to contracts + `lib/program.ts`)**

- **Cursor** — Credit envelope (annual planning); spend tracked against vendor data when synced  
- **ChatGPT + Codex** — Pooled credits + per-seat license line + overage economics  
- **M365 Copilot** — **Prepaid** enterprise commitment; level monthly planning line  
- **Claude.ai** — Placeholder until contract final

*Message:* One **planning total** leadership can track; details stay in FinOps sync with policy repo.

---

## Slide 8 — Current state (honest)

**Live today (preview)**

- Azure-hosted console, Entra sign-in, app-level RBAC  
- Real integrations **available** where secrets and consent are in place; synthetic fallback for demos  
- **Identity reconcile** and **vendor spend sync** (cron + manual) for operator accuracy  

**Still maturing**

- Custom domain / full production hardening per target architecture  
- **Write workflows** (tier moves, reclamation, exceptions) — next phase, policy-PR-backed  

---

## Slide 9 — What we are asking to *change* (proposal)

1. **Operating norm:** Treat the console as the **default** internal answer for “where are we on the AI program?” — with FinOps owning number updates in policy + code alignment  
2. **Access:** Expand **invited** operator and FinOps users as needed; **not** “everyone with an Entra account”  
3. **Discipline:** Material policy and inventory changes continue to flow through the **policy repository**, not ad hoc vendor clicks  
4. **Prioritization:** Sequence **hardening** vs **workflow** features with Security and Steering

---

## Slide 10 — Risk and mitigation

| Risk | Mitigation |
|------|------------|
| Console mistaken for “policy source of truth” | Clear charter: **policy repo + Entra** remain authoritative for rules and identity |
| Credential / integration sprawl | Key Vault, least privilege, integration toggles per environment |
| Vendor number mismatch | Vendor API sync + documented reconciliation (e.g. Cursor usage events) |
| Access creep | Invite-only model + auditable admin actions |

---

## Slide 11 — Decisions needed

- **Confirm** governance split (policy repo vs console vs Entra)  
- **Assign** FinOps owner for **program numbers** and review cadence  
- **Prioritize** next wave: **production hardening** vs **tier/exception workflows**  
- **Approve** production deploy path and named reviewers for promotion  

---

## Slide 12 — Next steps

- [ ] Steering acknowledgment of charter (this deck + policy brief)  
- [ ] FinOps: lock **Q__ planning numbers** in policy repo + console constants  
- [ ] Security: confirm integration list and data-handling posture  
- [ ] Engineering: [insert milestone — e.g. custom domain, workflow MVP]  

**Contact:** [insert]

---

### Speaker notes (optional)

- Emphasize: **thin workflow layer**, not a new policy silo.  
- Cursor / OpenAI tiles are **examples** of “vendor truth in our envelope” — good for credibility with Finance.  
- If asked about **Copilot**: prepaid commit is intentional; usage stories come later on the backlog.  
- If asked about **AI safety**: gateway and DLP live in the approved architecture; the console does not duplicate raw logging.
