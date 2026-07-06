# MASTER AUDIT PROMPT — Stellar dApp Submission Review & Fix

Copy everything below this line into a coding agent session (Claude Code, Antigravity, etc.) **with access to the existing project repository**. This prompt instructs the agent to audit the project against the official Level 3 challenge requirements and the known judging patterns from past rewarded/rejected submissions, then fix anything that's missing, broken, or fabricated.

---

## ROLE & GOAL

You are auditing an **existing Stellar Soroban dApp repository** before it is submitted to a hackathon-style challenge that is graded against a strict checklist. Your job has two parts:

1. **Audit** — go through every category below, check the real state of the repo (not what the README *claims*, the actual code/config/output), and produce a findings report.
2. **Fix** — for anything broken, missing, or fabricated, fix it for real. Do not mark something as fixed unless you actually did the work and verified it.

**Do not trust the existing README at face value.** Treat every claim in it as unverified until you've checked it against the actual code, actual test output, actual deployed contracts, and actual CI run. This audit exists specifically because past submissions have been rejected for claiming things (transaction hashes, screenshots, inter-contract calls) that weren't real or weren't actually demonstrated — your job is to catch and fix exactly that category of problem.

---

## PART 1 — FABRICATION / INTEGRITY AUDIT (highest priority — check this first)

This is the single most decisive factor separating rewarded from rejected submissions in past cycles. Go through the README and every doc in the repo and check:

- [ ] **Every transaction hash** is exactly 64 lowercase hex characters (`0-9a-f` only). Flag and fix anything shorter/longer or containing any character outside `0-9a-f` (e.g. letters g–z) — that is a fabricated placeholder, not a real hash.
- [ ] **Every contract address** is exactly 56 characters and starts with `C`. Flag anything that doesn't match.
- [ ] **Every transaction hash and contract address actually resolves** on `https://stellar.expert/explorer/testnet/...` — attempt to verify each one. If any do not resolve, they are either wrong, fabricated, or for the wrong network (e.g. mainnet vs testnet mismatch) — fix by re-deploying/re-executing for real and recording the actual values.
- [ ] **Every screenshot referenced in the README actually exists in the repo** as an image file, and actually shows what its caption claims (open and look at each one — don't assume from the filename).
- [ ] **Every link in the README resolves** — live demo URL, GitHub Actions badge, Stellar Expert links, demo video link. Flag broken or placeholder links (e.g. `example.com`, `your-link-here`, mismatched URLs that don't match each other).
- [ ] **No two different/conflicting URLs are given for the same thing** (e.g. one live demo link in the header and a different one in the body) — this was an actual cause of rejection in a past cycle.
- [ ] If anything in this section can't be made real (e.g. you don't have deploy access), **do not leave a fake value in place** — replace it with an explicit `PENDING — <reason, and what's needed to complete it>` note instead.

---

## PART 2 — CHECKLIST COMPLIANCE AUDIT

Go through the official Level 3 requirements one at a time. For each, check the **actual repo state**, not the README's claim, and fix any gap found.

### Inter-contract communication
- [ ] Open the actual contract source code. Confirm at least one contract genuinely calls another via `env.invoke_contract` (or the typed SDK client equivalent) — not two contracts that merely reference each other's addresses without ever calling them.
- [ ] Confirm the README has a section explicitly named/labeled "Inter-Contract Calls" (or equivalent) that names the specific functions involved and the mechanism used.
- [ ] Confirm there is a real transaction hash demonstrating this call actually executed on testnet (cross-check against Part 1).
- [ ] If missing or fake: implement (or fix) the real inter-contract call, write a test for it, execute it for real on testnet, and document it properly.

### Event streaming & real-time updates
- [ ] Confirm contracts actually emit events (`env.events().publish` or equivalent) for key actions.
- [ ] Confirm the frontend actually listens for or polls these events and updates the UI without a full page reload.
- [ ] If missing: add event emission to the relevant contract functions and wire up frontend polling/listening.

### CI/CD pipeline
- [ ] Confirm a `.github/workflows/*.yml` file exists.
- [ ] Confirm it has actually run (check the Actions tab / commit history for real workflow runs, not just the file's existence).
- [ ] Confirm the most recent run is passing (green), not red or never-run.
- [ ] Confirm the README's CI badge reflects the real workflow, and a real screenshot of a passing run exists.
- [ ] If broken/missing: fix the workflow, push, wait for it to actually run, capture a real screenshot of the green result.

### Smart contract deployment workflow
- [ ] Confirm each contract is actually deployed to Stellar testnet (verify the addresses per Part 1).
- [ ] Confirm there's a documented, reproducible deployment process in the README (commands, order of operations, any required initialization calls).

### Mobile responsive frontend
- [ ] Actually load the app (locally or via the live URL) at ~375px width and ~768px width. Check for horizontal overflow, unusably small touch targets, or a desktop layout that simply shrinks instead of adapting.
- [ ] Confirm a real mobile-width screenshot exists in the repo.
- [ ] If broken/missing: fix the responsive CSS/layout, capture a real screenshot at mobile width.

### Error handling & loading states
- [ ] Confirm at least 3 distinct error states are actually implemented and distinguishable in the UI (not just caught and logged to console): typically wallet-not-found, user-rejected-signature, insufficient-balance. Trigger each one manually if possible (e.g. try a transaction with too little balance) to confirm it behaves as claimed.
- [ ] Confirm pending/loading states are shown during transaction submission, not just before/after.
- [ ] If missing: implement the missing error states with clear, distinct user-facing messaging.

### Tests for contracts and frontend
- [ ] Actually run `cargo test` (or the project's real test command) and confirm tests pass for real — capture the actual terminal output.
- [ ] Count the passing tests — confirm there are at least 3 (the official minimum), and that they test meaningful behavior (not trivial assertions like `assert!(true)`).
- [ ] Check whether any frontend tests exist. If the official requirement expects frontend tests and none exist, add at least minimal meaningful tests (e.g. for key utility functions, error-state rendering, or the vesting/accrual/AMM math if applicable) — don't skip this just because contract tests exist.
- [ ] Confirm a real test-output screenshot exists in the repo.

### Production-ready architecture practices
- [ ] Check for basic hygiene: no hardcoded secrets/private keys committed to the repo, environment variables used correctly for config, no obviously dead code or commented-out blocks left in, reasonable file/folder organization.
- [ ] Fix anything egregious found (e.g. a committed secret key — rotate it immediately and remove it from history, then note this explicitly to the user).

### Documentation & demo presentation
- [ ] Confirm the README has a clear project description, setup instructions that actually work if followed from scratch, and a complete evidence section (contract addresses, tx hashes, screenshots) per Part 1.
- [ ] Confirm a demo video link exists and is real (cannot be auto-generated by an agent — if missing, flag this explicitly as a manual task for the human).

### Commit history
- [ ] Count actual commits on the main branch. Confirm at least 10 (official minimum), each with a meaningful, non-generic message (not all "update", "fix", "wip").
- [ ] If the history is a single mega-commit or has too few commits, **do not fabricate fake history** — instead, note this as a real limitation and, if there's meaningful incremental work still to do (fixes from this audit), make sure those land as separate, well-labeled commits going forward.

---

## PART 3 — README STRUCTURE AUDIT

Confirm the README has, as explicitly labeled sections (add any that are missing):

```
# <Project Name>
[CI/CD badge] [Stellar Testnet badge]
Live Demo: <real url, or honest PENDING>
Demo Video (1–2 min): <real url, or honest PENDING>
## Project Description
## Architecture
## Tech Stack
## Smart Contracts (Testnet)  — table: Contract | Address | Stellar Expert Link
## Inter-Contract Calls  — mechanism explanation + real tx hash evidence
## Wallet Connection
## Core Mechanics  — (vesting / accrual / AMM math, whichever applies)
## Error Handling  — explicit list of handled error types
## Screenshots  — wallet connected, core flow, success state, mobile UI, CI/CD run, test output
## Setup Instructions
## Testing  — how to run tests, real output
## License
```

For any section that's missing, weakly written, or unverifiable, rewrite it using only real, checked information gathered during this audit.

---

## PART 4 — OUTPUT: AUDIT REPORT

Before making any fixes, produce a findings report in this format so the human can see exactly what was wrong:

```
## Audit Findings

### 🔴 Critical (fabricated/broken — must fix before submission)
- [finding] — [why it's critical] — [fix applied or still needed]

### 🟡 Missing (required but absent)
- [finding] — [fix applied or still needed]

### 🟢 Passing (verified real and correct)
- [item] — [how it was verified]

### ⚪ Cannot be completed by an agent (needs the human)
- [item] — [what the human needs to do, and how]
```

Then proceed to actually implement every fix that's within your ability to do for real (code, tests, CI, deployment, README content). For anything you cannot do (recording a demo video, providing API credentials, etc.), leave it clearly flagged in the report rather than faking it.

---

## HARD RULES (apply throughout this audit, no exceptions)

1. Never replace a fake/missing value with a new fake value — replace it with a real one or an honest `PENDING` marker.
2. Never mark a checklist item as fixed without actually verifying the fix works (re-run the test, re-check the live URL, re-verify the hash on Stellar Expert).
3. Never fabricate commit history.
4. If a fix requires real testnet transactions, actually execute them — don't describe what *would* happen.
5. Report dishonestly-favorable findings as a failure of this audit, not a success.

Begin the audit now. Work through Part 1 first (it's the highest-leverage check), then Part 2, then Part 3, and finish with the Part 4 report.
