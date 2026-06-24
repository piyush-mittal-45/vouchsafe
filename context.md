# PROJECT_CONTEXT.md — Stellar dApp Challenge Submission Program

## 1. Project Overview

**Project name:** No single name — this is a multi-submission program for a Stellar blockchain dApp building challenge, with three distinct sub-projects developed/planned within it:

| Sub-project | Codename | Status |
|---|---|---|
| Payment Streaming Vault | **Cadence** | Built, deployed to Cloudflare Workers (repo: `ranzer001/Flowpoint`) |
| Stake & Earn Rewards Pool | **Accrue** | Master build prompt written, not yet built |
| Token Swap Liquidity Pool (AMM) | Unnamed | Master build prompt written, not yet built |

**Purpose:** Produce Stellar Soroban smart-contract dApps that satisfy a tiered challenge program (White Belt → Level 2 → Level 3) and are structured specifically to maximize the odds of being selected as a paid "winner" in the monthly review process.

**Problem being solved:** The challenge program rewards submissions based on a review process that (based on direct repo analysis, see Section 9) appears to mechanically check literal checklist compliance and verifiable on-chain evidence rather than purely subjective code quality. The "problem" being solved is: *design and build submissions that are functionally real, fully working, and structured so every grading criterion has unambiguous, checkable proof.*

**Target users:** The person running this program (referred to as "the user" throughout), who intends to hand off each master build prompt to a coding agent (Claude Code, Antigravity, or similar) to execute the build in a single pass.

**Goals:**
- Build genuinely functional Stellar testnet dApps (not demos that fake their core claims)
- Satisfy every line of the official challenge checklist for the relevant level
- Avoid the specific failure patterns identified in rejected past submissions
- Produce original work — explicitly avoid cloning/reskinning existing rewarded repos to pass review as new submissions

**Expected outcome:** Multiple independent, fully working dApp submissions, each with a deployed contract on Stellar testnet, a working frontend, real transaction evidence, and a README structured to make grading trivial for a reviewer.

---

## 2. Project Vision

- The program is explicitly optimizing for **selection probability**, not just technical correctness — the user wants to reverse-engineer what reviewers actually reward.
- Key principle established early: **idea complexity is not the differentiator** — four analyzed repos (2 rewarded, 2 not) were nearly structurally identical (same AMM/DeFi pattern, same tech stack, even the same reused testnet contract addresses across all four). What separated winners from losers was **evidence discipline**, not concept novelty.
- Core design philosophy carried through every subsequent build prompt: **never fabricate evidence.** Every transaction hash, contract address, screenshot, and live link in a README must be real and independently verifiable (e.g., resolvable on Stellar Expert). This was directly motivated by finding a literal invalid/fabricated transaction hash in one of the rejected repos.
- Each project should map its README **heading-for-heading** to the literal checklist items, so a reviewer can pattern-match compliance without needing to dig.
- Visual design should avoid the "dark glassmorphism crypto-dashboard" look that all four reference repos shared, since it's perceived as a templated, overused aesthetic that could make a submission look unoriginal.

---

## 3. Functional Requirements

### 3.1 Challenge Program Requirements (as given by the organizers)

#### Level 1 — White Belt
- Wallet Setup: Freighter wallet, Stellar Testnet — **Priority: High**
- Wallet Connection: connect + disconnect functionality — **High**
- Balance Handling: fetch and clearly display connected wallet's XLM balance — **High**
- Transaction Flow: send an XLM transaction on testnet; show success/failure state and transaction hash/confirmation — **High**
- Development Standards: UI setup, wallet integration, balance fetch, transaction logic, error handling — **High**
- Submission: public GitHub repo + README with project description, setup instructions, and screenshots (wallet connected, balance displayed, successful transaction, transaction result shown)

#### Level 2
- StellarWalletsKit implementation (multi-wallet) — **High**
- Error handling: wallet not found, rejected signature, insufficient balance (3 distinct types) — **High**
- Contract deployment to testnet — **High**
- Calling contract functions from the frontend (read + write) — **High**
- Event listening and state synchronization — **High**
- Transaction status tracking (pending/success/fail) — **High**
- Minimum 2+ meaningful commits
- Submission: public repo, README with setup instructions, screenshot of wallet options, deployed contract address, transaction hash of a contract call (verifiable on Stellar Explorer); live demo link optional

#### Level 3 — Advanced Smart Contracts + Production-Ready dApps (primary focus of this conversation)
- Inter-contract communication — **High**
- Event streaming & real-time updates — **High**
- CI/CD pipeline setup (real, running) — **High**
- Smart contract deployment workflow — **High**
- Mobile responsive frontend — **High**
- Error handling & loading states — **High**
- Tests for contracts and frontend (3+ passing minimum per the checklist) — **High**
- Production-ready architecture practices — **Medium**
- Documentation & demo presentation — **High**
- Submission requirements: public repo, README with complete documentation, **minimum 10+ meaningful commits**, live demo link, contract deployment address, transaction hash for contract interaction, screenshots (mobile responsive UI, CI/CD pipeline running, test output with 3+ passing tests), demo video link (1–2 minutes)

### 3.2 Sub-project Functional Specs

#### A. Payment Streaming Vault ("Cadence")
- Create a stream: sender locks XLM for a recipient over a duration — **High** — Status: **Implemented**
- Linear vesting calculation (`vested = deposit * min(elapsed, duration) / duration`) — **High** — Implemented
- Withdraw vested funds (recipient-only) via inter-contract call to Token contract — **High** — Implemented
- Cancel stream (optional) — **Medium** — status not confirmed in final repo
- Live ticker UI showing vested amount incrementing in real time — **High** — Implemented
- Wallet connect/disconnect, balance display — **High** — Implemented
- 3 distinct error states (wallet missing, rejected signature, insufficient balance) — **High** — per the build prompt; not independently re-verified by Claude
- Mobile responsive layout — **High** — required, status not independently verified

#### B. Stake & Earn Rewards Pool ("Accrue")
- Stake XLM into a pool (`Staking` contract custodies funds) — **High** — Not yet built
- `Staking → Rewards` inter-contract call on every stake/unstake to checkpoint accrual — **High** — Not yet built
- Fixed APY yield accrual calculation (basis points, e.g. 1200 = 12%) — **High** — Not yet built
- Claim rewards without unstaking; `Rewards → Token` inter-contract call mints/pays RWD token — **High** — Not yet built
- Unstake (partial or full), settling accrual first — **High** — Not yet built
- Live APY/rewards ticker UI — **High** — Not yet built
- Activity feed of stake/unstake/claim events — **Medium** — Not yet built
- 3 distinct error states — **High** — Not yet built
- Mobile responsive layout — **High** — Not yet built

#### C. Token Swap Liquidity Pool (unnamed AMM)
- `add_liquidity`: dual-asset deposit, mint LP shares proportional to contribution — **High** — Not yet built
- `swap`: constant-product formula (`x*y=k`) with fee and slippage protection (`min_amount_out`) — **High** — Not yet built
- `remove_liquidity`: burn LP shares, return proportional assets — **High** — Not yet built
- `Pool → Token` and `Pool → LPShare` inter-contract calls — **High** — Not yet built
- Live price/quote display, pool stats dashboard, price-history chart — **High** — Not yet built
- Live activity feed of swaps/liquidity changes — **Medium** — Not yet built
- 3+ distinct error states (wallet missing, rejected signature, insufficient balance, optionally slippage failure) — **High** — Not yet built
- Mobile responsive layout — **High** — Not yet built

---

## 4. Non-Functional Requirements

- **Evidence integrity (program-wide, non-negotiable):** No fabricated transaction hashes, contract addresses, or screenshots anywhere in any submission. Hashes must be 64 lowercase hex characters; contract addresses must be 56 characters starting with `C`. Both formats must be validated before being written into any README.
- **Verifiability:** Every contract address and transaction hash must actually resolve on `https://stellar.expert/explorer/testnet/...` before being published.
- **Mobile responsiveness:** Genuine adaptation at ~375px (iPhone SE) and ~768px (tablet) — not just a desktop layout that happens not to break.
- **Reliability of transaction feedback:** Every blockchain action must show pending → success/fail, never a silent failure.
- **CI/CD:** Must be a real, executed GitHub Actions pipeline (contracts test + build, frontend lint + build), not a decorative badge.
- **Maintainability/commit hygiene:** Minimum 12–15 incremental, meaningfully-labeled commits per project; no single mega-commit dumps.
- **Design distinctiveness:** Explicit instruction across all build prompts to avoid the generic dark-glassmorphism crypto-dashboard aesthetic.

---

## 5. Project Architecture

### A. Payment Streaming Vault ("Cadence")
- **Contracts:** `stream` (core logic, custody, vesting calc, withdraw) ←→ `token` (or native XLM via Stellar Asset Contract wrapper)
- **Inter-contract call:** `stream.withdraw()` invokes the token contract's transfer function via `env.invoke_contract`
- **Frontend :emoji_2194: contracts:** Next.js app reads `vested_amount`/`get_stream`, submits `create_stream`/`withdraw` via signed transactions through StellarWalletsKit
- **Deployment architecture (as actually implemented):**
  - Repo: `ranzer001/Flowpoint`
  - Frontend lives in `frontend/` subdirectory (Next.js 14, static export)
  - Root-level `wrangler.toml` drives Cloudflare Workers deployment:
    ```
    name = "flowpoint"
    compatibility_date = "2026-06-25"

    [build]
    command = "npx --yes npm@10.9.2 ci && npm run build"
    cwd = "frontend"

    [assets]
    directory = "./frontend/out"
    ```
  - `frontend/next.config.mjs` sets `output: 'export'` and `images: { unoptimized: true }`

### B. Stake & Earn Rewards Pool ("Accrue") — planned
- **Contracts:** `token` (RWD reward token) ← `rewards` (accrual + payout) ← `staking` (custody + checkpoint trigger)
- **Inter-contract calls:**
  1. `staking.stake()` / `staking.unstake()` → `rewards.register_stake()` (checkpoint accrual on principal change)
  2. `rewards.claim_rewards()` → `token` contract (mint/transfer payout)
- Native XLM used as the staked asset via SAC wrapper; no redundant token contract for the staked side.

### C. Token Swap Liquidity Pool — planned
- **Contracts:** `token` (custom tradeable asset) + native XLM (SAC) ←→ `pool` (AMM core, holds reserves) ←→ `lp_share` (provider share token)
- **Inter-contract calls:**
  1. `pool.add_liquidity()` / `pool.swap()` / `pool.remove_liquidity()` → `token` contract (asset transfers)
  2. `pool.add_liquidity()` → `lp_share.mint()`; `pool.remove_liquidity()` → `lp_share.burn()`

---

## 6. Technology Stack

Consistent across all three sub-projects unless noted:

| Layer | Technology |
|---|---|
| Smart contracts | Rust + Soroban SDK (latest stable at build time) |
| Frontend framework | Next.js 14 (App Router), TypeScript |
| Frontend output mode | Static export (`output: 'export'`) |
| Wallet integration | `@creit.tech/stellar-wallets-kit` (StellarWalletsKit), Freighter as primary tested wallet |
| Data fetching/polling | SWR |
| Styling | Tailwind CSS (CSS plain also acceptable per first prompt) |
| Animation | Framer Motion (sparing use) |
| Charts (AMM project only) | recharts (or similar lightweight lib) |
| Deployment | Cloudflare Workers static assets (via `wrangler.toml`) — confirmed working for Project A; Vercel/Netlify acceptable alternative |
| CI/CD | GitHub Actions |
| Network | Stellar Testnet, funded via Friendbot |
| Explorer/verification | Stellar Expert (`stellar.expert/explorer/testnet/...`) |

---

## 7. Complete Implementation Plan

Each sub-project follows the same phase structure (from the master prompts):

**Phase 1 — Contract layer**
- Objectives: implement all contracts, get inter-contract calls working for real
- Tasks: write contract logic, write 5–6+ unit tests, run `cargo test` to confirm real passing output
- Deliverables: working WASM builds, passing test suite, captured terminal output
- Completion criteria: tests pass locally with real assertions on inter-contract effects (e.g., balance changes)

**Phase 2 — Testnet deployment**
- Objectives: get real, verifiable on-chain artifacts
- Tasks: fund deployer account via Friendbot, deploy each contract in dependency order, execute real representative transactions (e.g., create+withdraw, or stake+claim+unstake, or add-liquidity+swap+remove-liquidity)
- Deliverables: real contract addresses, real transaction hashes
- Completion criteria: every address/hash verified resolvable on Stellar Expert

**Phase 3 — Frontend**
- Objectives: full wallet + contract interaction UI matching the spec
- Tasks: wallet connect/disconnect, core feature UI, live ticker/real-time elements, transaction feedback, 3+ error states, mobile responsive layout, distinctive (non-templated) visual design
- Deliverables: working Next.js app wired to real deployed contract addresses via build-time env vars
- Completion criteria: manually verified working end-to-end against testnet

**Phase 4 — CI/CD**
- Objectives: real automated pipeline
- Tasks: GitHub Actions workflow (contracts test+build job, frontend lint+build job), push and let it actually run
- Deliverables: passing workflow run, badge, screenshot of the real Actions tab
- Completion criteria: pipeline is observed green on a real push

**Phase 5 — Deployment & documentation**
- Objectives: live, reviewable submission
- Tasks: deploy frontend (Cloudflare Workers/Vercel/Netlify), update README with all real evidence, capture all required screenshots, record demo video
- Deliverables: final README matching the mandated structure, live URL
- Completion criteria: every README claim is independently verifiable; no placeholders remain except explicitly marked `PENDING` items not yet completed

---

## 8. Features That Must Be Implemented

### Payment Streaming Vault ("Cadence")
- [x] Wallet connect/disconnect
- [x] Create stream (lock funds for recipient over duration)
- [x] Linear vesting calculation
- [x] Withdraw (inter-contract call to token)
- [ ] Cancel stream (optional, status unconfirmed)
- [x] Live vesting ticker UI
- [x] Transaction pending/success/fail feedback
- [ ] 3 error states — implemented per build prompt, not independently re-verified
- [ ] Mobile responsive layout — implemented per build prompt, not independently re-verified
- [x] Real testnet deployment (Token + Stream contracts)
- [ ] CI/CD pipeline screenshot captured
- [ ] Test output screenshot captured
- [ ] Live demo URL added to README (was `PENDING` as of last check)
- [ ] Demo video recorded and linked
- [ ] Stellar Expert verification of the two recorded transaction hashes (offered, not yet completed)

### Stake & Earn Rewards Pool ("Accrue") — none yet implemented
- [ ] Token (RWD) contract
- [ ] Rewards contract (accrual model, register_stake, claim_rewards)
- [ ] Staking contract (stake, unstake, custody)
- [ ] 6+ passing contract tests
- [ ] Wallet connect/disconnect
- [ ] Stake UI flow
- [ ] Live APY/rewards ticker
- [ ] Claim Rewards button
- [ ] Unstake flow
- [ ] Activity feed
- [ ] 3 error states
- [ ] Mobile responsive layout
- [ ] CI/CD pipeline
- [ ] Real testnet deployment of all 3 contracts
- [ ] Real stake/claim/unstake transactions with verified hashes
- [ ] Frontend deployment
- [ ] README per mandated structure

### Token Swap Liquidity Pool — none yet implemented
- [ ] Token contract
- [ ] LP share contract (mint/burn restricted to pool)
- [ ] Pool contract (add_liquidity, swap, remove_liquidity)
- [ ] 6+ passing contract tests including constant-product invariant test
- [ ] Wallet connect/disconnect
- [ ] Swap UI with live quote + slippage setting
- [ ] Add/remove liquidity UI
- [ ] Pool stats dashboard + price history chart
- [ ] Live activity feed
- [ ] 3+ error states (incl. optional slippage failure)
- [ ] Mobile responsive layout
- [ ] CI/CD pipeline
- [ ] Real testnet deployment of all 3 contracts
- [ ] Real add-liquidity/swap/remove-liquidity transactions with verified hashes
- [ ] Frontend deployment
- [ ] README per mandated structure
- [ ] Project name chosen (not yet decided)

---

### 9.What Makes This Project Successful

This section is derived from direct analysis of four real submission repositories: two rewarded (`modiv2/orbit_money`, `kiwi-v1/Novapay`) and two not rewarded (`peachyv1/voltpay`, `loveyv1/fluxpay`). All four were structurally near-identical (same AMM/DeFi concept, same tech stack, even the same reused testnet contract addresses), meaning **idea complexity did not determine outcome.**

### What rewarded submissions did, specifically:
- Included a dedicated **"Inter-Contract Calls"** README section naming the actual mechanism used (e.g., `env.invoke_contract::<()>`) and which functions invoke it — not just an abstract claim.
- Included a **real, correctly-formatted transaction hash** with a direct Stellar Expert link as literal on-chain proof of an inter-contract call.
- Included a **Screenshots section mapped explicitly to the checklist** — e.g. a mobile view screenshot and a CI/CD pipeline screenshot/badge shown together, pre-answering exactly what a reviewer is told to check for.
- Included contract address tables with Stellar Expert links for every contract.
- Had clear architecture diagrams, a clean "Getting Started" section, and one consistent live demo link (no conflicting URLs).

### What non- selected submissions did wrong, specifically:
- **Fluxpay (fatal flaw):** Its example transaction hash was `7a2b9c8d1e3f4a5b6c7d8e9f0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t` — this string contains letters g–t, which don't exist in hexadecimal, making it an obviously fabricated placeholder that cannot resolve on any real explorer. It also listed two different, conflicting live demo URLs.
- **Voltpay:** Never included a transaction hash for any contract interaction at all (a literal required checklist line item), never named or described the inter-contract mechanism despite listing multiple contracts, and included no CI/CD or test-output screenshots — only generic product UI screenshots.

### Resulting judging model (working theory, applied throughout this program):
1. Reviewers (or their process) appear to **mechanically check the checklist against verifiable, linkable evidence**, not subjective code quality alone.
2. A single fabricated artifact (like Fluxpay's impossible hex string) can sink an otherwise complete-looking project — this is treated as a hard, unforgivable failure mode throughout every build prompt in this program.
3. Why each criterion matters:
   - **Real tx hashes/contract addresses:** the only objective, checkable proof that "inter-contract communication" and "contract deployment" actually happened as claimed.
   - **Checklist-mirrored README headings:** reduces reviewer effort to find compliance evidence, directly improving the odds of a favorable/quick review.
   - **Required screenshots captured literally:** CI/CD and test-output screenshots are explicit checklist line items in the official Level 3 requirements — omitting them is a direct, avoidable compliance gap.
   - **Consistent live demo links:** inconsistency (as in Fluxpay) signals carelessness and undermines trust in the rest of the submission's claims.
   
---

## 10. Important Decisions Made

| Decision | Reasoning | Trade-offs / Alternatives considered |
|---|---|---|
| Focus Level 3 submissions on a 3-contract architecture with genuine inter-contract calls | Directly matches the highest-weighted, most checkable grading criterion identified from repo analysis | Simpler 1–2 contract ideas were considered but rejected as weaker evidence of "inter-contract communication" |
| Avoid the AMM/liquidity-pool concept for the *first* two recommended ideas | All 4 reference repos already used this exact pattern with identical reused contract addresses — a 5th near-clone risked looking copied | Considered sticking with AMM since it's the only directly-proven-to-win pattern; user chose distinct ideas (Payment Streaming, Stake & Earn) instead, then later returned to an AMM concept for the third project after deciding to build it originally rather than clone Novapay |
| Build Payment Streaming Vault first (codename Cadence) | Highest visual "wow factor" for a short demo video (a live incrementing number), simplest unambiguous inter-contract call to prove | Stake & Earn and Escrow Marketplace were also strong candidates; ranked second/third |
| Use native XLM via Stellar Asset Contract (SAC) wrapper instead of writing a redundant token contract for the primary asset, across all three sub-projects | Reduces unnecessary contract surface area while keeping a real custom token (RWD, or the AMM's tradeable token) for the parts that need their own logic | Could have written a fully custom token for every asset; deemed unnecessary complexity |
| Static export (`output: 'export'`) + Cloudflare Workers static assets as the deployment target | Confirmed working in practice for Project A (Flowpoint); avoids needing a Cloudflare adapter (`next-on-pages`/OpenNext) since the architecture has no server-side API routes (all contract/wallet calls are client-side) | Vercel/Netlify offered as acceptable alternatives in later prompts |
| `NEXT_PUBLIC_*` environment variables must be set in the Cloudflare dashboard **before** deployment, not just locally | With static export, these values are baked in at build time; omitting them causes silent runtime failures (undefined contract addresses) | None — this is a hard technical constraint of the chosen architecture |
| Hard "no fabricated evidence" rule applied identically across all three master build prompts | Directly traced to the single most decisive failure mode found in the rejected repos (Fluxpay's invalid hex tx hash) | None considered — treated as non-negotiable from the first build prompt onward |
| Project naming: "Cadence" (streaming), "Accrue" (staking) | Chosen to sound like legitimate, distinct product names rather than generic "-Pay"/"-Swap" naming used by all four reference repos, and to avoid the two projects sounding like variations of each other | Several alternatives offered per project (Driblet, Trickle, Vesta, etc. for streaming; Sprout, Verdant, Stakewell, Ember for staking) |

---

## 11. Constraints

- **Single-prompt build constraint:** Each project must be buildable end-to-end by a coding agent from one comprehensive prompt, without iterative back-and-forth debugging during the build — this shaped the master prompts to be extremely explicit and directive (hard rules, exact function signatures, exact README structure, exact commit plan).
- **Coding agent capability limits (acknowledged, not solved):**
  - No agent can record a real screen-capture demo video — this must be done by the human after the app works.
  - Some sandboxed coding agents may lack live shell/CLI access to actually run Stellar testnet deployment commands; if so, the agent should hand the human exact commands to run rather than fabricating results.
- **Monthly submission deadline** — exists per the original challenge description but the specific date was not provided in this conversation.
- **Network/runtime constraint discovered in practice:** With `output: 'export'`, Next.js bakes `NEXT_PUBLIC_*` values in at build time, so they must be present wherever the build actually executes (Cloudflare's build environment), not just in a local `.env` file.
- **Cloudflare Workers Builds form behavior (discovered in practice):** When a root-level `wrangler.toml` already defines a `[build]` command, the dashboard's "Build command" field should be left blank to avoid duplicate/conflicting build execution.

---

## 12. Assumptions

- Assumed a fixed APY (e.g. 12%, expressed as `apy_bps = 1200`) is acceptable for the Stake & Earn project rather than a dynamic/market-driven rate.
- Assumed nelify deployment (proven for Project A) is an acceptable default deployment target for the other two projects unless the user specifies otherwise.
- Assumed the four reference repos' shared/reused testnet contract addresses indicate a common shared template circulating among many challenge participants, rather than each developer deploying fully independent contracts — used as supporting evidence that *concept/template reuse itself* isn't disqualifying, but *fabricated evidence* is.
- Assumed the user's "make it differ from the original" framing for the Novapay clone request was intended as a literal reskin-to-pass-review strategy rather than a coincidental description of legitimate independent rebuilding; this assumption directly informed the decision to decline that specific request.

---

## 13. Future Improvements

**Short-term:**
- Verify the two Payment Streaming Vault (Flowpoint) transaction hashes and both contract addresses on Stellar Expert (explicitly offered by Claude, not yet executed at the time of this export)
- Update the Flowpoint README's `Live Demo` line with the real deployed Cloudflare URL
- Record and link the 1–2 minute demo video for Flowpoint
- Capture the still-missing screenshots flagged in Flowpoint's own README ("Additional Screenshots Required for Production Verification": wallet connected state, stream creation flow, live vesting ticker, successful withdrawal, mobile responsive UI, CI/CD pipeline run)
- Choose a name for the Token Swap Liquidity Pool project
- Decide whether to build Stake & Earn ("Accrue") or the Token Swap project next

**Long-term / stretch goals mentioned:**
- `cancel_stream` function for the streaming vault (sender-initiated early cancellation with pro-rata split) — explicitly framed as a way to combine streaming's automatic guarantee with escrow-like discretion
- Global (not just per-user) activity feed for the staking pool
- Multi-hop swap support or additional trading pairs for the AMM project (not detailed, only implied by "Token Swap Interface" being one of the original Level 2 project idea categories)
- Leaderboard-style features (raised only at the early brainstorming stage as a separate, unbuilt project idea — "Token Leaderboard")

---

## 14. Known Issues

- Flowpoint (Cadence) README still contains `PENDING` placeholders for Live Demo and Demo Video links as of the last check in this conversation — these are intentionally honest placeholders, not bugs, but must be resolved before final submission.
- The two transaction hashes and two contract addresses recorded in the Flowpoint README have correct *format* (validated as 64-hex and 56-char-starting-with-C respectively) but have **not yet been independently confirmed to resolve on Stellar Expert** within this conversation — Claude offered to verify this and the user has not yet confirmed completion.
- Stake & Earn and Token Swap projects exist only as build specifications — no code, tests, deployments, or repos exist yet for either.
- Whether the Payment Streaming Vault's optional `cancel_stream` function, 3 error states, and mobile responsiveness were actually implemented (vs. only specified in the prompt) was not independently re-verified by Claude after the agent's build — this remains an open verification gap.

---

## 15. Implementation Details

### Vesting formula (Payment Streaming Vault)
```
vested_amount = deposit * min(elapsed_time, duration) / duration
```

### APY accrual formula (Stake & Earn Rewards Pool)
```
accrued_rewards = accrued_unclaimed + (principal * apy_bps * elapsed_seconds) / (10_000 * SECONDS_PER_YEAR)
```
- `apy_bps`: APY expressed in basis points (e.g. 1200 = 12%)
- On every `register_stake` or `claim_rewards` call, accrual is "settled": compute accrual on the old principal up to now, add to `accrued_unclaimed`, then reset `checkpoint_time`

### Constant-product AMM formula (Token Swap Liquidity Pool)
```
x * y = k   (reserve_token * reserve_xlm = k, fee deducted from amount_in before computing amount_out)
```
- First liquidity deposit: shares minted ≈ `sqrt(token_amount * xlm_amount)`
- Subsequent deposits: shares minted proportional to existing reserves
- Swap must enforce `amount_out >= min_amount_out` (slippage protection) or fail
- Invariant to test: `reserve_token * reserve_xlm` must never decrease from a swap (only increase, from fees)

### Required environment variables (Flowpoint / Cadence, confirmed pattern to reuse for future projects)
| Variable | Value (Flowpoint instance) |
|---|---|
| `NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS` | `CBE6EUK2MXBDXLMWOSD6Y4DQCJOUAMEA5LFIWJCWJ5XQ5FZT4YXDHOTD` |
| `NEXT_PUBLIC_STREAM_CONTRACT_ADDRESS` | `CCP65ERUSMNI25ZOO7P6C4HG4FVIJBMCPZPZW7AQGQA6653EOLETMJBG` |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org:443` |

None of these require Cloudflare's "Encrypt" option since they're all public values (contract addresses, RPC endpoints), not secrets.

### Recorded Flowpoint testnet evidence (format-validated, not yet independently confirmed on-chain by Claude)
- Token contract: `CBE6EUK2MXBDXLMWOSD6Y4DQCJOUAMEA5LFIWJCWJ5XQ5FZT4YXDHOTD`
- Stream contract: `CCP65ERUSMNI25ZOO7P6C4HG4FVIJBMCPZPZW7AQGQA6653EOLETMJBG`
- Transaction hash 1: `1254a65133f37a5c153e17e995ebddfac658b776b05100c7b99d39baa2d2ab06`
- Transaction hash 2: `6c2b029f2c6e926bf3683ac6ce2aca217081e2543782722b62694a97bb719fc3`

### Validation rules established for all evidence (program-wide)
- Transaction hash: must be exactly 64 lowercase hex characters (`0-9a-f` only)
- Contract address: must be exactly 56 characters, starting with `C`
- Any value not yet real must be written literally as `PENDING — generate after deployment`, never a plausible-looking fake

---

## 16. Code Snippets

### Flowpoint root `wrangler.toml` (confirmed, actual repo content)
```toml
name = "flowpoint"
compatibility_date = "2026-06-25"

[build]
command = "npx --yes npm@10.9.2 ci && npm run build"
cwd = "frontend"

[assets]
directory = "./frontend/out"
```

### Flowpoint `frontend/next.config.mjs` (confirmed, actual repo content)
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
```

### Soroban inter-contract invocation pattern (specified pattern, used conceptually across all three projects)
```rust
env.invoke_contract::<ReturnType>(&token_contract_id, &symbol_short!("transfer"), vec![...])
```

---

## 17. Development Workflow

**Commit convention (identical structure mandated across all three master build prompts, minimum 12–15 commits per project, no squashing):**
1. `chore: project scaffold (Next.js + Soroban workspace)`
2. `feat:` — one commit per contract/major contract function group
3. `test:` — unit tests commit (5–6+ passing tests)
4. `feat: wallet connect/disconnect via StellarWalletsKit`
5. `feat:` — one commit per major UI flow (core action UI, dashboard/live ticker UI)
6. `feat: error handling (...)`
7. `feat: mobile responsive layout`
8. `ci: GitHub Actions pipeline for contracts + frontend`
9. `chore: testnet deployment + real contract addresses wired in`
10. `docs: README with full evidence (addresses, tx hashes, screenshots)`

**Branch strategy / PR process:** Not discussed — no explicit branching model was specified in this conversation; commits appear to be intended for `main`.

**Deployment process (confirmed working, Flowpoint):**
1. Fill Cloudflare "Create a Worker" form: Project name as repo name, leave Build command blank (handled by `wrangler.toml`), leave Deploy command (`npx wrangler deploy`) and Non-production branch deploy command (`npx wrangler versions upload`) at default, Path = `/` (repo root, where `wrangler.toml` lives)
2. Add all required `NEXT_PUBLIC_*` variables (unencrypted) before deploying
3. Click Deploy, monitor build log for `npm ci` → `next build` inside `frontend/` → upload of `frontend/out`
4. Manually verify the live URL: wallet connect, core action flow, mobile width
5. Update README's `Live Demo` line with the real URL and commit

---

## 18. Testing Requirements

| Project | Minimum tests | Required coverage |
|---|---|---|
| Payment Streaming Vault | 5 | create_stream success/lock amount; vested_amount at t=0/half/full; withdraw transfers correct amount via real inter-contract call; withdraw fails for non-recipient; create_stream input validation (zero deposit/duration) |
| Stake & Earn Rewards Pool | 6 | stake locks principal + triggers register_stake correctly; accrued_rewards mathematically correct at a known timestamp/APY; claim_rewards actually invokes token contract and increases balance; claim_rewards resets accrual, no double-pay; unstake settles accrual before returning principal; unstake fails gracefully if amount exceeds principal |
| Token Swap Liquidity Pool | 6 | add_liquidity on empty pool sets correct initial ratio/shares; add_liquidity on non-empty pool mints proportional shares; swap output matches constant-product formula incl. fee; swap rejects trades below min_amount_out; remove_liquidity returns proportionally correct amounts and burns correct shares; constant-product invariant never decreases across a sequence of swaps |

- All test output must be captured from a **real, actually-executed** `cargo test` run — this output is reused both as README content and as the source for the required test-output screenshot.
- End-to-end/manual verification required for: wallet connect/disconnect, all 3+ error states, mobile layout at ~375px, and the live deployed URL matching README claims.
- No frontend unit/integration testing framework was explicitly specified beyond manual verification — this is a gap relative to the official Level 3 checklist's "Writing tests for contracts and frontend," not yet resolved in this conversation.

---

## 19. AI Instructions

These are the standing behavioral instructions established for any coding agent executing a master build prompt in this program (apply identically to future projects unless the user states otherwise):

- **Never fabricate** a transaction hash, contract address, account ID, or screenshot. If real evidence isn't available yet, write an explicit `PENDING` placeholder, never a plausible-looking fake.
- **Validate format** of every hash (64 lowercase hex) and contract address (56 chars, starts with `C`) before writing it into any document.
- **Every official checklist item must have a literally-labeled, matching README section** — use the checklist's own wording as the heading.
- **All claimed inter-contract relationships must be real**, implemented via actual Soroban cross-contract invocation, and demonstrable in real transaction effects — not simulated.
- **Build incrementally** with a minimum of 12 (15 in practice) real, separately-labeled git commits following the standard commit plan in Section 17 — never one large commit dump.
- **All test output, CI runs, and deployments must be actually executed**, not narrated as if they happened.
- **Originality:** do not reference, copy, or pattern-match against any named existing reference repository's code, file structure, variable names, or UI design. Build an independent, clean-room implementation from the functional spec.
- **Design direction:** avoid the generic dark-glassmorphism crypto-dashboard look common to prior reference repos; choose one distinctive, intentional visual identity and apply it consistently; design the "hero" live numeric element (ticker/counter) as the visual centerpiece.
- **Output format for README:** must follow the exact heading structure specified per-project in each master prompt (see Section 15 of each individual master prompt document for the canonical structure).
- **If a step cannot be completed for real** (e.g., no shell/CLI access to deploy, can't record a video), the agent must stop and report this rather than fabricating a result.

---

## 20. Project TODO List

### High Priority
- [ ] Verify Flowpoint's two contract addresses and two transaction hashes on Stellar Expert
- [ ] Add the real Cloudflare live demo URL to Flowpoint's README
- [ ] Record and link Flowpoint's 1–2 minute demo video
- [ ] Capture Flowpoint's remaining required screenshots (wallet connected, stream creation, live ticker, successful withdrawal, mobile UI, CI/CD pipeline run)
- [ ] Decide which project to build next: Stake & Earn ("Accrue") or Token Swap Liquidity Pool
- [ ] Execute the full build (contracts → tests → deployment → frontend → CI/CD → README) for whichever project is chosen next

### Medium Priority
- [ ] Choose a name for the Token Swap Liquidity Pool project
- [ ] Decide on frontend testing approach to fully satisfy the official "tests for contracts **and frontend**" checklist line (currently only contract-level testing is specified in the master prompts)
- [ ] Confirm whether Flowpoint's optional `cancel_stream` function was actually implemented

### Low Priority
- [ ] Consider implementing `cancel_stream` for Flowpoint if not already present
- [ ] Consider a global (pool-wide) activity feed for the staking project
- [ ] Consider multi-pair/multi-hop support for the AMM project

---
