# Final word — AI Program Console (executive close)

**WDTS is standardizing how we run the approved AI stack.** The AI Program Console is the **operational cockpit**: one invite-only place that shows **program health**—cost, capacity, and posture—across Cursor, ChatGPT, Codex, Claude.ai, and M365 Copilot, using **our** planning envelopes and, where live, **vendor-reconciled** spend. It does **not** replace the **policy repository** (rules and inventory still change through Git) or **Entra** (identity); it **does** own **dashboard access** and the **decision ledger** for how we operate the program day to day.

**We are asking leadership to:** confirm that split, put **FinOps** on the hook for keeping **program numbers** aligned with policy and code, and **sequence** security hardening with the next wave of **governed workflows** (tiers, reclamation, exceptions)—so we scale usage without scaling ambiguity, surprise spend, or silent policy drift.

**Deliverables:** policy brief (`ai-program-console-policy-brief.md`), slide copy (`ai-program-console-executive-deck.md`), and generated deck (`WDTS-AI-Program-Console-Executive-Brief.pptx`). Regenerate the `.pptx` after edits: `python3 scripts/build-executive-deck.py` (requires `python3 -m pip install python-pptx`).
