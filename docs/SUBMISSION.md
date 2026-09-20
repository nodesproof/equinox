<!-- trace: idea="Equinox — an options AMM for ETH on Arbitrum whose prices are computed entirely on-chain (Black-Scholes in Stylus, volatility from Chainlink prints, no IV oracle)" | event="Arbitrum Open House Singapore: Online Buildathon" | deadline="2026-10-01 23:59 SGT (15:59 UTC) per T&C; HackQuest shows 2026-10-04 23:59 SGT — unresolved" | source=submission-packager -->
# Submission — Equinox → HackQuest project form

**Portal:** https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon (status `SUBMIT` open; re-fetched 2026-09-20 07:42 UTC: `updatedAt 2026-09-20T07:42:11Z`, `submissionClose 2026-10-04T15:59Z`, `registrationClose 2026-10-02T17:01Z`, `rewardTime 2026-10-12T06:00Z`, 854 participants, `projectCount 43`, 18 submitted projects in the gallery (GraphQL `listProjects … isSubmit: true`, incl. Vigil), every custom field `maxCharacters: 300`, form labels and sponsor options unchanged from `../../docs/HACKATHON_BRIEF.md`).
**Deadline planned against:** **2026-10-01 23:59 SGT (15:59 UTC, 22:59 WIB)** — the Singapore T&C's "Submission Deadline: October 1, 2026, 11:59 PM SGT". HackQuest shows Oct 4 23:59 SGT. This document does not resolve the conflict: submit by Oct 1 and ask an organizer in writing (Discord `#open-house`, engineering@arbitrum.foundation, openhouse@arbitrum.foundation) which date governs. T&C §3.2: "Late submissions will not be accepted." The T&C PDF itself could not be re-fetched today (HTTP 429, Vercel checkpoint) — the quote stands as captured in `../../docs/.scout-dumps/openhouse-arbitrum-io-terms-singapore.md` on 2026-09-19.
**Registration:** done (user, 2026-09-19 — the same registration that carries Vigil). **Submission:** not yet submitted. This is the user's **second project** on the same registration; neither the T&C nor the HackQuest page states a per-participant cap on submitted projects (`DATA TIDAK DITEMUKAN: max projects per participant`) — confirm at feedback session #2 (Wed 23 Sep 09:00 UTC) or in `#open-house` before pasting, and keep the two entries clearly distinct (different repo owner `nodesproof`, different chain, different problem).
**Pre-condition for every link below:** PRs #4 (pool) and #5 (Sepolia) and the Plan 3b PR must be merged to `main` — the dashboard URL (GitHub Pages, `build_type: workflow`, deploys only from `main`) returned **HTTP 404 on 2026-09-20 07:45 UTC**, and the keeper cron only fires from `main`. See `DEMO_RUNBOOK.md` › Timeline (merge by Wed 23 Sep).

Character counts were measured with Python `len()` on the exact strings below (newlines count as 1; the CRLF worst case adds 1 per line break and is shown where relevant). Paste each block verbatim.

## Part 1 — Custom form fields (verbatim order and labels from the form)

### 1. `Link to frontend/UI/website of your project` — 37 chars
```
https://nodesproof.github.io/equinox/
```
Live only after the PRs merge (`.github/workflows/pages.yml` runs on push to `main` touching `web/**` or `deployments/**`). Until then the page is 404 — do not submit before it is up (T&C §3.3 "functional and demonstrable at the time of submission").

### 2. `List your Core Protocol/ Smart Contract Addresses` — 280 chars (CRLF worst case 282)
```
Arbitrum Sepolia: 0x7f79616217cc49edea777108b60981d7bf807cc9 — EquinoxPool B (Stylus math)
Arbitrum Sepolia: 0xb3b37050a40b9755001bddd29cc5df17a59f51d4 — black_scholes Stylus program (cached)
Arbitrum Sepolia: 0xc331031a1730a567fd9149d5950912a1cdcb6a3e — EquinoxVolEngine (shared)
```
Why these three: Pool B is the product (ERC-4626 vault + options AMM priced by the Stylus program); the Stylus program is the "Use of Arbitrum technology" a judge will look for (cached — `ArbWasmCache.codehashIsCached == true`, `programTimeLeft` 364 days on 2026-09-20); the vol engine is the "no IV oracle" claim (EWMA of Chainlink prints, shared by both pools — decision K4). **Cut for the 300-char cap** (all in `deployments/arbitrum-sepolia.json` and the README table): Pool A control `0x627b099c3e475f851d15ca9f261cd2f5b8b8be08` → field 3; `BlackScholesSol` control `0x5B239AE1510AED1Bb21EB9d2e8A471D45720c4B3` and `Bench` `0x5801Aa89eAdABDE9ea21D2e26858760F8B71f346` (README › Getting started); the two option tokens → field 4; `PoolE2EDeployer` `0xeb64b16e491f82497ea545a65b3db3d3e6c92df3` (deploy tx `0x72ed0db0…778fc`, block 310687948); Chainlink ETH/USD `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` (real, not ours); `MockSequencerFeed` `0x5154d98ac5c21aac01c0db923db484a7364139ff`. Network label "Arbitrum Sepolia" is the form's own option ("Arbitrum Sepolia — Arbitrum testnet"); chain id 421614 is in the JSON.

### 3. `List your Factory/Pool Contracts (if applicable)` — 256 chars (CRLF worst case 258)
```
Arbitrum Sepolia: 0x2014077542088eCeFf980221CFc7Fa6b96A4F2e5 — EquinoxFactory (two-level)
Arbitrum Sepolia: 0x627b099c3e475f851d15ca9f261cd2f5b8b8be08 — EquinoxPool A (Solidity control, same vol engine)
Both pools: ERC-4626 vaults over USDG; 12 series each
```
Rationale: `EquinoxFactory` (address read on-chain from `PoolE2EDeployer.factory()` on 2026-09-20 — it is not in the JSON) created both pools (`createPool` for B, `createPoolWithVol` for A so they share one engine); Pool A is the control the whole benchmark story rests on. "12 series each" = 2 boards × 3 strikes × call/put (board 0: 25 Sep 2026 08:00 UTC, strikes 2400/2600/2800; board 1: 2 Oct 2026, 2200/2600/3000). Not "N/A".

### 4. `List your Token Contract Address (if applicable)` — 287 chars (CRLF worst case 289)
```
Arbitrum Sepolia: 0xbd1cb2556b5a2ad232f913a5390d57a7f35942c1 — MockUSDG (6 dp, open mint = faucet; stand-in, no USDG on Sepolia)
Arbitrum Sepolia: 0x2ce0ead79441bf9e1bba8075aef031da98ed70d0 — EquinoxOptionToken B (ERC-1155 series)
Pool A token: 0xb275911e4d0af3640d48234d6f1cdce6f43aacc6
```
Decision: not "N/A". The option token *is* a token (one ERC-1155 id per series, `seriesId = keccak256(pool, expiry, strike, isCall)`), and the LP share of each pool is an ERC-20 (ERC-4626) at the pool address itself (field 2/3). `MockUSDG` is listed so the judge sees, in the form itself, that USDG is a stand-in: Paxos has no USDG deployment on Arbitrum Sepolia (Plan 3 spec §1, verified 2026-09-20), the mock is 6-decimal with an open `mint` used as the faucet and implements none of Paxos's pause/blocklist controls (PRD §11 T9 documents that risk against the real token).

### 5. `Which parts of your code have been produced during the Buildathon?` — 294 chars
```
All of it. Repo created 2026-09-19 (window opened Sep 14); 81 commits on 19–20 Sep: Rust bs-math + Stylus program, Solidity control, pool, vol engine, factory, tests, benchmark, Sepolia deploy, keeper, dashboard. Only deps: OpenZeppelin 5.4.0, PRBMath 4.1.0, forge-std, stylus-sdk 0.10.9, viem.
```
Evidence behind it (`git log` on `feat/plan-3b`, 2026-09-20): first commit `72f60a5` 2026-09-19 10:37:09 +0800 "chore: init repo, toolchain check, verification record"; 81 commits through `f51c20e` (2026-09-20 "pages: GitHub Pages workflow for the dashboard"), every one dated 19 or 20 Sep 2026 and structured by feature (`feat(bs-math)` × 8, `feat(contracts)` × 5, `fix(contracts)`/`fix(pool)` audit rounds, `deploy(sepolia)`, `keeper`, `demo(sepolia)`, `web` × 6, `docs`). Vendored (tracked, no submodules) in `contracts/lib/`: `openzeppelin-contracts` 5.4.0, `prb-math` 4.1.0, `forge-std` 1.16.2; Rust: `stylus-sdk` 0.10.9, `alloy-primitives` 1.5.7 (`stylus/bs-stylus/Cargo.toml`), toolchain 1.92.0; web: `viem` ^2.21, Vite 6, vitest 2. The PRD (`prd-arsitektur.md`, v1.0 → v1.3) was also written in-window (19 Sep). Update the commit count in the field if more land before pasting (`git rev-list --count main` after the merges).

### 6. `Which sponsor/partner technologies have you used as part of your project?` — checkbox (mandatory, multi-select)
The checkbox has **no option for Arbitrum Stylus or Chainlink** (options verbatim: `GMX`, `Robinhood Chain`, `Dune Analytics`, `ZeroDev`, `Fhenix`, `Alchemy`, `AWS`, `OpenZeppelin`, `Paxos/USDG`, `Have not used any`) — Stylus and the Chainlink feed go into the description and the tech tags instead. Tick:
- [x] `OpenZeppelin` — `ERC4626`, `ERC20`, `ERC1155`, `Ownable2Step`, `ReentrancyGuard`, `SafeERC20`, `Math` from openzeppelin-contracts 5.4.0 (vendored in `contracts/lib/`; `EquinoxPool is ERC4626, Ownable2Step, ReentrancyGuard`).
- [ ] `Paxos/USDG` — **user decides, see Part 3.** Default recommendation: do not tick (the only USDG on Sepolia is our `MockUSDG`; there is no fork test against the real token). If ticked, the caveat in field 4 and in the description must stay exactly as written.
- [ ] `GMX`, `Robinhood Chain`, `Dune Analytics`, `ZeroDev`, `Fhenix`, `Alchemy`, `AWS`, `Have not used any` — do not tick (the RPC is the public `sepolia-rollup.arbitrum.io`, not Alchemy; nothing runs on Robinhood Chain).

### 7. `Contract Address` (HackQuest built-in, optional) — 42 chars
```
0x7f79616217cc49edea777108b60981d7bf807cc9
```
`EquinoxPool B` — the pool a judge should quote and trade against (Stylus math; the dashboard's Trade panel defaults to B). If the built-in field wants the Stylus program instead, use `0xb3b37050a40b9755001bddd29cc5df17a59f51d4`.

## Part 2 — HackQuest project profile

| Field | Value |
|---|---|
| Project name | `Equinox` |
| Logo | The only mark in the repo is the dashboard favicon — an inline SVG in `web/index.html` line 8 (dark disc `#0b1220` with a gold ring `#f2c94c`, 64×64 viewBox). Export it to a 512×512 PNG for the upload (e.g. `rsvg-convert -w 512`); `DATA TIDAK DITEMUKAN`: HackQuest logo size/format requirement. |
| One-line intro (≤ 100 chars) — **91 chars** | `On-chain ETH options AMM on Arbitrum Stylus: volatility from Chainlink prints, no IV oracle` |
| Tech tags (`teachStack`) | `Rust`, `Solidity`, `TypeScript`, `Python` (the event page tags are `Solidity`, `Rust` — tick both: the Stylus program is Rust, the pool is Solidity; `DATA TIDAK DITEMUKAN`: HackQuest's fixed tag list) |
| Sector tags (`tracks`) | `DeFi`, `Infra` (the Stylus math library is a public dependency other contracts can call — PRD §14 "Distribution") |
| Prize tracks (`prizeTrack`, multi-select) | `Overall Prize` + `Promising Products Track` ("new financial primitives" is the track's own wording) + `Grants` (discretionary; costs nothing to tick) |
| `demoVideo` | not recorded yet — `VIDEO_SCRIPT.md` (3:00, five sections; the settlement + claim section can only be shot after Fri 25 Sep 08:00 UTC). Upload the mp4 or a YouTube link once cut; **do not submit without it** (T&C scores "Presentation quality"). |
| `pitchVideo` | the same file (the script opens with the problem and closes with the honest gas table, so it doubles as the pitch). |
| Open-source link (`openSourceLink`) | `https://github.com/nodesproof/equinox` (public, MIT, default branch `main`) |
| Project links | dashboard `https://nodesproof.github.io/equinox/` · Pool B `https://sepolia.arbiscan.io/address/0x7f79616217cc49edea777108b60981d7bf807cc9` · Stylus program `https://sepolia.arbiscan.io/address/0xb3b37050a40b9755001bddd29cc5df17a59f51d4` · shared vol engine `https://sepolia.arbiscan.io/address/0xc331031a1730a567fd9149d5950912a1cdcb6a3e` · first Pool B trade `https://sepolia.arbiscan.io/tx/0x1815a3fa652b6436aba283fa26c4cf1c0275deea259066f6969e85e95c9e7ff5` · benchmark `https://github.com/nodesproof/equinox/blob/main/docs/BENCHMARK.md` · demo log `https://github.com/nodesproof/equinox/blob/main/docs/DEMO_LOG.md` |
| Team | solo — `nodesproof` (GitHub org/user of the repo), adiadi2411@gmail.com (the registered HackQuest account is the same person as Vigil's `mdlog`; state that in the form if asked — two repos, one builder) |
| Wallet | Arbitrum One address given at registration (prizes are paid in USDC on Arbitrum One, T&C §6.3.1) — `DATA TIDAK DITEMUKAN`: which address was entered; verify it is the one you control. |

### Description (judge-facing write-up, ≈ 480 words — paste as-is; if the form wants it shorter, drop the last sentence of **Problem** first, −40 words)

Equinox is an options AMM for ETH on Arbitrum whose prices are computed entirely on-chain: Black-Scholes runs in Rust via Arbitrum Stylus, and the implied volatility it needs is derived on-chain from Chainlink prints. The only external input is the spot price. Two identical pools are live on Arbitrum Sepolia — one priced by the Stylus program, one by a Solidity control — so a judge can check that the math is bit-identical and see what Stylus actually buys.

**Problem.** Every live on-chain options venue we know of feeds implied volatility — the one Black-Scholes input that cannot be observed — from a server or a team-run oracle. On a 7-day 5 % OTM ETH call, 10 vol points move the premium 33 %: whoever controls that number controls the transfer of value between LPs and traders. Black-Scholes itself runs on the EVM (Lyra, 2021); what gets cut is the full loop — Greeks per quote, an iterative implied-vol solve, mark-to-market NAV across every open series, realized-vol updates — so teams pruned it or moved pricing off-chain.

**Mechanism.** σ_base is an EWMA of log-returns between Chainlink rounds, stored on-chain; σ_mark = σ_base × VRP × (1 + α·inventory), with a symmetric spread so round-trips are never free. LPs deposit USDG into an ERC-4626 vault and are the writer; traders buy 7–30-day European calls and puts as ERC-1155 series, cash-settled in USDG on a Friday 08:00 UTC grid. Puts are reserved at K; calls pay `min(S_T − K, K)` and are priced as `C(K) − C(2K)`, so the pool can never owe more than it holds (the cap costs buyers < 0.001 % of premium at 60 % vol, ≤ 30 days). NAV is marked at σ_mark(0) and trades never cross it, which closed the deposit/redeem sandwich found in review.

**Evidence.** A Python exact-integer spec, the Rust/Stylus program and the Solidity control are bit-identical on 1,284 vectors; 20/20 on-chain exactness checks pass on Sepolia. 87 Foundry tests, 7 invariants at 51,200 calls each, 93.4 % line coverage on pool + oracle, CI. Gas, measured honestly: Stylus is 2.6–2.9× cheaper on loops (20-iteration IV solve 223k vs 617k gas; 32-series mark-to-market 427k vs 1.24M), under 1× on small single calls, and only ≈ 1× (0.99–1.08×) on whole pool transactions, which storage dominates. The 10× target was retracted; the benchmark is part of the product.

**Live.** Real Chainlink ETH/USD feed, one shared vol engine, two pools with 12 series each and 1,000,000 USDG seed liquidity, a keeper cron, a dashboard with wallet trading (faucet, deposit/redeem, buy/close/claim) and a demo log linking every transaction, including one out-of-gas failure and its post-mortem. USDG and the L2 sequencer feed are mocks on Sepolia; nothing else is. First real settlement: Fri 25 Sep 2026 08:00 UTC.

**Next:** i128 Q64.64 internals, Arbitrum One with the real USDG, delta hedging via perps, BTC, options on tokenized equities. Solo builder.

Sources for every number in the description: sensitivity 33 % / 17 % — PRD §6.7 (C 4,200 7 d: 58.62 → 78.14 at +10 vol points); cap cost < 0.001 % — PRD §6.3 table (30 d, 60 %: 0.00088 %); 1,284 vectors — `python3 tools/reference/gen_vectors.py` output on 2026-09-20 (`exp 22 ln 20 sqrt 15 phi 341 pdf 161 quote 700 capped 6 iv 11 ewma 5 portfolio 3`); 20/20 — `tools/bench/onchain-check.sh deployments/arbitrum-sepolia.json`, re-run 2026-09-20 07:40 UTC, 20 × OK; 87 tests / 7 invariants / 51,200 calls — `forge test` (87 passed, 0 failed, 9 suites, re-run 2026-09-20) and README › Status (256 runs × depth 200 in the long run; CI runs 32 × 128); 93.4 % — PRD §12 (`forge coverage --ir-minimum`, 428/458 lines on `src/pool` + `src/oracle`); gas rows — `docs/BENCHMARK.md` (devnode table + Sepolia cached-measured table, identical cell for cell; "≈ 1× (0.99–1.08×)" spans exactly the three devnode pool rows of BENCHMARK › "Transaksi pool end-to-end": `buy` 387,211 vs 367,932 = 1.05×, `close` 254,792 vs 235,533 = 1.08×, `deposit` with 6 open series 219,538 vs 220,352 = 0.99× (README and PRD §13 state the same 0,99–1,08×; the 1.10× deposit row was the superseded pre-fix measurement); the Sepolia like-for-like rows 1.11× / 1.25× are *not* comparable, see BENCHMARK › "Transaksi pool di Sepolia"); 1,000,000 USDG seed — `tools/sepolia/list-boards.sh` (`SEED=1000000000000`); out-of-gas tx — `docs/DEMO_LOG.md` (`0x1262c6cb…`, 349,720 gas = gasLimit); settlement date — `deployments/arbitrum-sepolia.json` board 0 `expiry 1790323200`.

## Part 3 — Paxos/USDG decision (user decides)

Facts: the pool is USDG-denominated by design — the asset is 6-decimal (`assetScale = 1e12`), premiums, reserves, escrow and settlement are in USDG, PRD §14 names USDG's MAS/MiCA regulation as the reason over USDC, and PRD §11 T9 / §9.7 document the real token's pause/blocklist risk. But: **Paxos has no USDG on Arbitrum Sepolia** (Plan 3 spec §1, verified 2026-09-20), the deployment uses `MockUSDG` (6 dp, open `mint`, no `isFrozen`), there is **no fork test against the real USDG** (unlike Vigil), and PRD §18 V9 (USDG address and decimals on Arbitrum One) is still `⬜` unverified. The brief: "Extra consideration is given to projects integrating Paxos' USDG stablecoin"; 4 of 18 submitted Singapore entries tick it (NERON & LYRA, Hashling, Truvial, Vigil — gallery 2026-09-20).
Recommendation: **do not tick** by default — a sponsor judge who opens the field-4 address finds `MockUSDG`, and "integrating" a mock is the kind of claim T&C §7.1 ("false or misleading information") is written for. If the user wants the tie-breaker anyway, tick **only** with the caveat kept verbatim in field 4 ("MockUSDG … stand-in, no USDG on Sepolia") and in the description ("USDG and the L2 sequencer feed are mocks on Sepolia"), and verify V9 first so the Q&A answer "production uses the real 6-decimal USDG on Arbitrum One" has an address behind it. Nothing else in the package depends on this choice.

## Part 4 — Deliverables checklist (from `../../docs/HACKATHON_BRIEF.md` › Deliverables)

- [x] Register on HackQuest before `2026-10-02T17:01Z` — done (user, 2026-09-19; same registration as Vigil).
- [ ] **TODO** Submit the project by the conservative deadline `2026-10-01T15:59Z` (Oct 1 23:59 SGT) — after the PRs merge and the video is cut; paste Parts 1–2; screenshot the confirmation.
- [x] Deployed contracts on an Arbitrum chain — Arbitrum Sepolia 421614 (T&C §3.1 names it; on the form's network list), 12 Solidity contracts of ours + the cached Stylus program, addresses in `network: address — label` format (fields 2/3/4).
- [x] T&C §3.3 "functional and demonstrable at the time of submission" — pools quote live on the real Chainlink feed (20/20 exactness checks and the dashboard's parity column re-verified 2026-09-20), `cast call` try-it block in the README, 87 tests, demo log with Arbiscan links. **Keep it true until judging ends:** an open board must exist after 2 Oct 08:00 UTC (list the 9 Oct and 16 Oct boards — `DEMO_RUNBOOK.md` › Timeline) and the keeper wallet must stay funded (top-up 5–6 Oct).
- [ ] **TODO** Link to frontend/UI/website — field 1; 404 until the PRs merge (`DEMO_RUNBOOK.md` › Pre-flight item 1).
- [x] Core contract addresses (field 2); Factory/Pool (field 3); Token (field 4) — none is "N/A".
- [x] Written statement of in-window work — field 5; git history starts 2026-09-19 10:37 +0800.
- [x] Sponsor-tech checkbox — field 6 (OpenZeppelin; Paxos/USDG per Part 3).
- [x] GitHub repo public — https://github.com/nodesproof/equinox (MIT); no `engineering-AF` invite needed.
- [ ] **TODO** HackQuest project profile: name, logo (export the favicon SVG to PNG), one-line intro, description, tech tags, `demoVideo` (not recorded) — values in Part 2.
- [x] Prize-track selection — `Overall Prize` + `Promising Products Track` (+ `Grants`).
- [ ] After winning: grant agreement (T&C §6.3.3, or forfeit), possible KYC/AML (§6.3.2), USDC on Arbitrum One to the registered wallet (§6.3.1); 25/25/50 milestones apply to the Overall Prize only — the 50 % tranche needs "A successful mainnet launch on an Arbitrum Chain": Equinox's mainnet path is Arbitrum One with program caching (`cargo stylus cache bid`) and the real USDG (README › Roadmap), not yet executed.

## Part 5 — DQ red flags (T&C §7.1 and HackQuest platform reasons), each confirmed avoided

- "Submitting work that is not original or modified during the Buildathon period" — ✓ repo created 2026-09-19 inside the Sep 14–Oct 4 window, 81 in-window commits; field 5 states it; only OSS dependencies imported (pinned, vendored).
- "Plagiarism or infringement of third-party intellectual property" — ✓ OpenZeppelin 5.4.0 (MIT), PRBMath 4.1.0 (MIT; the Solidity control uses it and the Rust `exp`/`ln` are *ports* of PRBMath's algorithms, credited in the README › How it works and `stylus/bs-math/src/exp.rs`/`ln.rs`), forge-std (MIT/Apache-2.0), stylus-sdk 0.10.9 (MIT/Apache-2.0), Cody's rational erfc approximation (published algorithm, cited), Chainlink `AggregatorV3Interface` (MIT). Lyra's inventory-impact mechanism is credited in PRD §1 and JUDGE_QA Q16. Equinox itself is MIT.
- "Providing false or misleading information" — ✓ mocks disclosed in the form (field 4), the description, the dashboard footer ("Mocked on purpose: USDG and the sequencer uptime feed…") and the README; the "10×" claim retracted everywhere (PRD §2.4, BENCHMARK, README); pool quotes are *not* claimed byte-identical as a standing property (K5); no "audited", "mainnet", "real USDG" claims anywhere (Part 6).
- "Acting in bad faith … circumvent Buildathon rules" — ✓ two genuinely different projects from one builder, each with its own repo, chain, PRD and deployment; if the organizer says one project per participant, withdraw one — do not split a team identity.
- Code of Conduct "Shilling the latest meme coin" / "Providing financial or investment advice" — ✓ no token, no yield promises, no advice; the description reports measured gas and test counts, not returns; PRD §14 forbids projections.
- HackQuest "Not deployed on designated ecosystem" — ✓ Arbitrum Sepolia is on the form's network list and satisfies T&C §3.1 verbatim ("Arbitrum Sepolia").
- HackQuest "Does not fit any prize tracks" — ✓ "new financial primitives" is the Promising Products Track's own wording; Overall Prize is open.
- HackQuest "Incomplete project" — ✓ every mandatory field has content; nothing is "N/A" or "TBD" — **except** the logo PNG and the video, which must exist before pasting (Part 4 TODOs).
- Late submission (§3.2) — ✓ by planning to Oct 1 23:59 SGT, not Oct 4.
- Video length / format — no rule published (`DATA TIDAK DITEMUKAN: demo-video rules`); the script is sized to 3:00 like Vigil's (`VIDEO_SCRIPT.md`).
- Arbitrum Nova — ✓ not used.
- Robinhood Chain reservation — not claimed: Equinox is an "Arbitrum" project for the "≥ 1 of 3 reserved for a project building on Arbitrum" rule; it competes for at most 2 of 3 slots per track (brief › Podium arithmetic).

## Part 6 — Do not claim (not true today; must not appear in any field, video or Q&A)

- **"10× cheaper" / "Stylus makes Black-Scholes 10× cheaper"** — retracted (PRD §2.4, §13 "Aturan kejujuran"); say "2.6–2.9× on loops (IV solver, 32-series mark-to-market), < 1× on small single calls, ≈ 1× (0.99–1.08×) on whole pool transactions, program cached".
- **"Both pools return identical quotes" as a standing property** — false since the put on Pool A was refilled against a later Chainlink round (netVega Δ 1.64 → quotes differ ≈ 0.0006 USDG, 2 × 10⁻⁵ relative, DEMO_LOG/BENCHMARK). Say "**math parity**: both `math` contracts return byte-identical prices for identical inputs (20/20 on-chain; dashboard parity column); pool quotes are shown side by side and legitimately differ through the inventory term of σ_mark(util)" (K5). The byte-identical `quoteBuy` at block 310700824 is a historical fact, quoted with its block.
- **"Real USDG" / "Paxos USDG on Sepolia" / "real L2 sequencer uptime feed"** — both are mocks (`MockUSDG` with open `mint`; `MockSequencerFeed` with an open `set` that the keeper self-heals). Chainlink publishes no sequencer uptime feed on Arbitrum Sepolia; the mainnet one is `0xFdB631F5EE196F0ed6FAa767959853A9F217697D` (Plan 3 spec §1).
- **"Mainnet" / "Arbitrum One deployment"** — nothing is deployed there; V9 (USDG on One) unverified.
- **"Audited" / "security-reviewed by a third party"** — three internal fix rounds + a final review (commits `c33e706`, `f7661f7`, `11511b9`, `c2fecdd`…`994b862`), 87 tests, 7 invariants; no external audit; owner is an EOA without timelock (PRD §11 T14).
- **"The settlement happened" / "the video shows the settlement"** — not until Fri 25 Sep 2026 08:00 UTC has passed and `--claim` has appended to `docs/DEMO_LOG.md`; until then say "first real settlement is scheduled for…".
- **"No oracle"** — spot still comes from Chainlink; say "no **IV** oracle" (PRD §2.4).
- **"~2,000 test vectors"** (README › Repository layout) — the README counts rows: the committed `vectors_gen.rs` has 1,984 rows = 1,284 exact-integer vectors (exp 22, ln 20, sqrt 15, Φ 341, pdf 161, quote 700, capped 6, IV 11, EWMA 5, portfolio 3) + 700 float-reference `FLOAT_PRICE` rows for the same quote inputs; the Solidity subset has 182; PRD §0 says "1.250". Say "1,284 exact-integer vectors (+700 float-reference rows)".
- **"Every options venue uses an off-chain IV oracle"** as a verified fact — verified on 2026-09-20 for Premia v3 (SSVI volatility-surface oracle, docs.premia.blue) and Stryke CLAMM (IV "sourced from market data" fed into oracles, docs.stryke.xyz); Rysk and Moby remain `⬜` (PRD §18 V13). Say "every live venue we know of".
- **"Sepolia gas ratios 1.11× / 1.25× prove Stylus is more efficient at the transaction level"** — those rows share one Stylus engine and a cached program and are explicitly *not* comparable with the devnode rows (BENCHMARK › "Transaksi pool di Sepolia"); quote the devnode 1.05×/1.08×/0.99× rows for the transaction-level claim.
- **"Deep-OTM tails are priced precisely"** — the precision argument was withdrawn (PRD §2.4: A&S 26.2.17 is within 1 % to d = −6); the floor `minPremiumBps` is a risk parameter, not a precision claim.
- **"Cheap capital rent is mitigated"** — T17 is *accepted and documented* (5 bps × K rents the reserve for the tenor); `minListingDelta` (FR-20) is P1, not built.
- **"Keeper guarantees settlement"** — permissionless settle + 2 USDG bounty; the keeper only speeds things up (PRD §11 T2 "operator MUST run a keeper").
- **"first ever"** — say "to our knowledge no bit-identical Stylus-vs-Solidity quant benchmark has been published" (PRD §0) and credit Lyra v1 for on-chain Black-Scholes and inventory-impact IV.
- Any revenue projection beyond PRD §14's illustrative "1 M USDG premium/month × 3 % = 30k USDG/month — small".

## Part 7 — Deadline verification at packaging time

HackQuest event page re-fetched 2026-09-20 07:42 UTC (`updatedAt 2026-09-20T07:42:11Z`): `submissionClose 2026-10-04T15:59:00Z`, `registrationClose 2026-10-02T17:01:00Z`, `rewardTime 2026-10-12T06:00:00Z` — unchanged since the brief. Singapore T&C PDF: re-fetch blocked (HTTP 429, Vercel checkpoint, curl with browser UA); the Oct 1 23:59 SGT deadline stands as captured on 2026-09-19 (`../../docs/.scout-dumps/openhouse-arbitrum-io-terms-singapore.md` line 13: "Submission Deadline: October 1, 2026, 11:59 PM SGT"; line 98: "Late submissions will not be accepted."). **DEADLINE CONFLICT UNRESOLVED — confirm manually with an organizer; plan for Oct 1.**
