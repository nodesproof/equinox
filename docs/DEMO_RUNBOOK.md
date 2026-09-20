<!-- trace: idea="Equinox — an options AMM for ETH on Arbitrum whose prices are computed entirely on-chain (Black-Scholes in Stylus, volatility from Chainlink prints, no IV oracle)" | event="Arbitrum Open House Singapore: Online Buildathon" | deadline="2026-10-01 23:59 SGT (15:59 UTC) per T&C; HackQuest shows 2026-10-04 23:59 SGT — unresolved" | source=submission-packager -->
# Demo runbook — Equinox (on-chain ETH options priced by Black-Scholes in Arbitrum Stylus, σ from Chainlink prints, no IV oracle)

**Judging format:** 100 % online, off-platform panel (`disableJudge: true`; no roster published). There is no stage. A judge consumes five surfaces, in roughly this order: the HackQuest entry → the live dashboard → the repo → the explorer → the recorded video. This runbook makes each surface survive on its own, schedules the one event that cannot be faked (the first real settlement, Fri 25 Sep 2026 08:00 UTC), and gives the user a rehearsal-ready MetaMask path for the video take.
**Deadline planned against:** 2026-10-01 23:59 SGT (15:59 UTC, 22:59 WIB) per the Singapore T&C. HackQuest shows 2026-10-04 23:59 SGT. Not resolved here — confirm with the organizers (Discord `#open-house`, engineering@arbitrum.foundation); work to Oct 1 until they answer in writing.
**Notation:** `⟨…⟩` marks a value that does not exist yet (settlement price, payouts — read them from `docs/DEMO_LOG.md` after Fri 25 Sep 08:00 UTC) or that is user-specific (a wallet address); nothing else in this file is a placeholder.
**Target for the live-style walkthrough:** 3 minutes across the dashboard; wow-moment at ≈ 1:00 (a `buy` signed in MetaMask that prices itself inside the Stylus program on a public chain) and again at ≈ 2:00 (the settled board and a `claim`, Friday onwards).

**Wow-moment (must be REAL):** a `buy` on Pool B — the transaction `STATICCALL`s the cached Stylus WASM program `0xb3b37050a40b9755001bddd29cc5df17a59f51d4` for `cappedCall`/`quote`, with σ_mark computed by `EquinoxVolEngine` `0xc331031a1730a567fd9149d5950912a1cdcb6a3e` from **real Chainlink ETH/USD prints** (`0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165`, 120 s heartbeat); the same quote is reproduced byte-for-byte by the Solidity control `0x5B239AE1510AED1Bb21EB9d2e8A471D45720c4B3` on the dashboard's parity column (K5) and by `tools/bench/onchain-check.sh` (20/20, re-run 2026-09-20). It is REAL on every surface: on-chain (first Pool B `buy` `0x1815a3fa…9e7ff5`, 345,781 gas, `docs/DEMO_LOG.md`), on the dashboard (Trade panel → Buy → Arbiscan link), and from `cast` (README › Try it). What is MOCKED is the environment on Sepolia: **USDG** (`MockUSDG` `0xbd1c…42c1`, 6 dp, open `mint` = faucet) and the **L2 sequencer uptime feed** (`MockSequencerFeed` `0x5154…39ff`, always up, open `set`) — Paxos has no USDG and Chainlink no uptime feed on Arbitrum Sepolia (Plan 3 spec §1). Say this before a judge asks (`JUDGE_QA.md` › Say this before anyone asks).

## Surfaces and their links

| Surface | Link | State expected during judging |
|---|---|---|
| HackQuest entry | https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon → Project Gallery → `Equinox` | fields pasted from `SUBMISSION.md`; both prize tracks ticked; video uploaded |
| Live dashboard | https://nodesproof.github.io/equinox/ | **404 on 2026-09-20 07:45 UTC** — goes live when `.github/workflows/pages.yml` runs from `main` (after PRs #4, #5 and the Plan 3b PR merge); then badge `live`, 12 series rows with Parity `✓`, gas line, Trade panel |
| Repo | https://github.com/nodesproof/equinox (public, MIT, last 15 CI runs on 19–20 Sep all `success`) | `forge test`: 87 passed, 0 failed (9 suites); `cargo test`: 23 passed; `onchain-check.sh`: 20 × OK |
| Explorer (Arbiscan Sepolia) | Pool B `https://sepolia.arbiscan.io/address/0x7f79616217cc49edea777108b60981d7bf807cc9` · Stylus program `…/address/0xb3b37050a40b9755001bddd29cc5df17a59f51d4` · shared engine `…/address/0xc331031a1730a567fd9149d5950912a1cdcb6a3e` · first Pool B trade `…/tx/0x1815a3fa652b6436aba283fa26c4cf1c0275deea259066f6969e85e95c9e7ff5` · the out-of-gas tx `…/tx/0x1262c6cb7975acd5b1265a98e877a58d727f231a98a4dbbe29897fed38a39386` | tx pages resolve (HTTP 200 on 2026-09-20); contracts are **not source-verified** (Sourcify `match: null` on 2026-09-20; no verify step exists in the repo) — see Pre-flight item 4 |
| Recorded video | not recorded — `VIDEO_SCRIPT.md` (3:00; the settlement + claim section is shot after Fri 25 Sep 08:00 UTC) | upload to HackQuest `demoVideo` (and `pitchVideo`) |

## Pre-demo setup (do this before anyone judges)

- [ ] Seed state: already on-chain — 1,000,000 USDG LP per pool from the owner (`tools/sepolia/list-boards.sh`, `SEED=1000000000000`), 12 series per pool (boards 25 Sep / 2 Oct), owner positions 5 C 2800 #0 + 1 P 2400 #0 on both pools (`docs/DEMO_LOG.md`). Nothing to re-seed per judge; judges mint their own mock USDG from the Faucet button.
- [ ] Reset between judging rounds: not needed (permissionless pools; every judge's trade is real state and stays). What must be **maintained**: an open board at all times (Timeline: list 9 Oct + 16 Oct boards on 25 Sep), the keeper wallet funded (top-up 5–6 Oct), and `MockSequencerFeed` "up" (the keeper self-heals it every 15 min; manual: `cast send $SEQ "set(int256,uint256)" 0 $(( $(date -u +%s) - 7200 ))` from any funded key — the setter is open).
- [ ] Backup: screenshots of every dashboard panel taken right after Pages goes live (save under `docs/assets/` in the *workspace* `../../docs/assets/`, outside the repo, as Vigil did) and the recorded video itself — both wifi-independent.
- [ ] Stage (for the video take only): 1920×1080 window, browser zoom 100 %, notifications off, MetaMask unlocked on Arbitrum Sepolia, the filming account funded (Section C), `?poll=4000` on the dashboard URL so state refreshes 4 s after each tx instead of 15 s.

## A. The 3-minute "judge opens the links" path (dashboard)

Nobody has driven this page in a browser yet — the URL is 404 until the merges. Every "What the judge sees" cell below quotes the labels the panels render (`web/src/panels/*.ts`); numbers that change (spot, σ, quotes, block, countdown) are shown as read at packaging time (block 310801603–310802097, 2026-09-20 07:38–07:41 UTC) and will differ. **Confirm every row in a real browser during the rehearsal log at the bottom, or let the main session verify it with claude-in-chrome once Pages is live.**

| Time | Action (exact click / route) | What the judge sees (on-screen labels quoted from the panel source) | REAL or MOCKED | Verified |
|---|---|---|---|---|
| 0:00–0:15 | Open https://nodesproof.github.io/equinox/ ; point at the header | `Equinox` · tagline `On-chain ETH options priced by Black-Scholes in Arbitrum Stylus — volatility from Chainlink prints, no IV oracle` · badge `Arbitrum Sepolia · 421614` · status badge `live` (green; `stale` if the last poll is old, `connecting` at first paint) · `block 3108…` · links `GitHub ↗`, `Pool B on Arbiscan ↗` | REAL (polls the public RPC every 15 s via Multicall3) | UNVERIFIED-IN-BROWSER |
| 0:15–0:45 | Panel `Volatility engine (shared) & NAV` | `Chainlink ETH/USD` `2574.42 USD · 2m ago` (real feed, 120 s heartbeat) · `σ_base (EWMA realized vol)` `0.5508` · `σ_mark(0) = σ_base × VRP` `0.6335 (VRP 1.15, α 0.30, spread 5.00 %)` · `Board #0 expiry` `2026-09-25 08:00 UTC · in 4d 23h …` / `Board #1 expiry` `2026-10-02 08:00 UTC · in …` (after Friday: `settled @ ⟨price⟩ (A) / ⟨price⟩ (B)`) · two cards `control (BlackScholesSol)` and `Equinox (Stylus)`: `NAV (totalAssets)` `1,000,098.72 USDG` / `1,000,099.37 USDG` · `NAV / share` · `cash − escrow − MtM liability` · `reserved (Σ OI × K)` `16,400.00 USDG` on both · `free liquidity` · `net vega / util` `541.1 / 1.08 % of cap 50000` · `σ_mark(util)` · `capital reference (lagged)` · `trading paused` `no`. Say: σ came from Chainlink prints, nothing else; the two NAVs differ by ≈ 0.65 USDG because the demo transactions on A and B landed at different timestamps and A's put was refilled on a later Chainlink round — timing and inventory, not math (`docs/BENCHMARK.md` › "Transaksi pool di Sepolia") | REAL (feed, engine, both pools) | UNVERIFIED-IN-BROWSER |
| 0:45–1:15 | Panel `Series board — Pool A (control) vs Pool B (Stylus)` — the 12 rows, then the gas line | Columns `Board · K · C/P · Buy A · Buy B · Δ · Close A · Close B · Parity · OI A · OI B · σ_buy A \| B`; 12 rows `#0 2026-09-25 08:00` × {2400, 2600, 2800} × {C, P} and `#1 2026-10-02 08:00` × {2200, 2600, 3000}; **`Parity` column `✓` on every live row** (both math contracts called with identical S, K, t, σ_mark(0) at the same block and compared as full tuples — `web/src/chain/parity.ts`); `Δ` shows `=` or a relative difference — say: **the Δ is inventory, not math** (Pool A's put was refilled on a later Chainlink round: netVega 541.07 vs 542.70); the ATM row is highlighted; below: `gas buy(1 C 2600, 2026-09-25 08:00): A 361406 · B 318602 · ratio 1.13×` (eth_estimateGas from the seed-LP wallet; cached program; shared engine, so the difference is the two pricing calls). **Wow for a technical judge:** two different VMs, one price, checked live every 15 s | REAL (quotes from both pools; parity from both math contracts) | UNVERIFIED-IN-BROWSER |
| 1:15–2:00 | Panel `Trade — from your wallet (Arbitrum Sepolia)` → `Connect wallet` → `Faucet 100,000 USDG` → `Approve USDG for pool B` → `Buy`: pick `C 2600 #1 (2 Oct)`, units `0.1` → read the preview → `Buy` → confirm in MetaMask | Without a wallet: `No injected wallet found — the panel is read-only. Install MetaMask, add Arbitrum Sepolia (chain 421614)…` (the page still shows everything). With MetaMask: summary `USDG` · `LP shares A \| B` · `USDG allowance A \| B` · `Positions A` / `Positions B`; radio `Pool A B` (default **B**); preview `premium ≈ 11.33 + fee ≈ 0.34 ≈ 11.67 USDG (max ≈ 11.79) · σ ≈ 0.667 · Δ ≈ 0.49` (Pool B on 2026-09-20 at spot ≈ 2576 — the numbers move with spot and σ, and a quote read a few seconds apart differs in the last decimals); after signing: log line `✓ buy 0.10 C 2600 #1 (2 Oct) on B — tx 0x1234abcd… ↗` (Arbiscan link); the snapshot re-reads within one poll and `Positions B` shows `0.10 C 2600 #1 (2 Oct)`. **WOW (must be REAL): the premium the judge just paid was computed inside the Stylus program from σ derived from Chainlink prints; nothing off-chain touched it.** If the simulation reverts, the decoded reason appears *before* the wallet opens (`Reserve cap reached…`, `Series is in the 60-second blackout…`, `Not enough USDG — use the faucet.`) | **REAL** (`buy` on Pool B; USDG is MOCKED) | UNVERIFIED-IN-BROWSER |
| 2:00–2:30 | Same panel → `Close`: pick the position, units `0.05` → `Close`; (Friday onwards) `Claim`: pick `C 2600 #0 (25 Sep) — 0.10 units` → preview `0.10 units × ⟨payout⟩/unit = ⟨USDG⟩` → `Claim` | `proceeds ⟨p⟩ USDG (min ⟨p × 0.99⟩) · σ_close 0.6xx` then `✓ close 0.05 …`; claim shows `✓ claim 0.10 C 2600 #0 (25 Sep) on B — tx …`. Say: close < buy on the same state (INV-9/16, no free round-trip); claim pays `min(S_T − K, K)` for a call, `K − S_T` for a put, from escrow the pool reserved when it sold the option | REAL | UNVERIFIED-IN-BROWSER |
| 2:30–3:00 | Panel `Activity — pool events (A \| B) & σ_base history (shared engine)` → then the footer `Contracts` | Table `Pool · Event · Series · Amount · Block · Tx` with the judge's own `Bought`/`Closed` rows on top of the demo-log rows (`Bought`, `Closed`, later `Settled`, `Claimed`); note `N events since deploy`; right: the σ_base polyline with `N observations since deploy; last σ_base 0.5508 at block 3107… (ETH 2573.29 USD, Chainlink round …41691)`. Footer: 8 address rows with Arbiscan links, then the disclosure sentence `Mocked on purpose: USDG and the sequencer uptime feed have no Sepolia equivalents; the price feed is the real Chainlink ETH/USD…` and `build ⟨commit⟩ · ⟨time⟩` | REAL (events from chain; the seed file `events-seed.json` is only a cache) | UNVERIFIED-IN-BROWSER |

`?rpc=http://127.0.0.1:8545` points the page at a local node (loopback only); `?poll=4000` shortens the refresh to 4 s (floor 2,000 ms). Both are read from `web/README.md` and useful for the take.

## B. CLI path for a technical judge (< 5 minutes, no key)

```bash
git clone https://github.com/nodesproof/equinox.git && cd equinox
python3 tools/reference/wad_emul.py                       # last line: SELFTEST OK  (the executable spec)
cd stylus/bs-math && cargo test && cd ../..               # 23 passed (bit-exact vs 1,284 generated vectors)
cd contracts && forge test && cd ..                       # "87 tests passed, 0 failed, 0 skipped (87 total tests)", 9 suites, ≈ 15 s
cd contracts && forge test --match-contract Narrative -vv && cd ..   # prints the §13 narrative table (below)
tools/bench/onchain-check.sh deployments/arbitrum-sepolia.json      # 20 × OK — Stylus AND Solidity vs the Python spec, public RPC, read-only
```

Expected `Narrative.t.sol` output (deterministic, Pool A control, re-run 2026-09-20; labels are Indonesian — say what each line is):

```
| LP deposit | 1,000,000.000000 USDG -> 1000000000000 share |
| sigma_mark(0) | 0.6325 (0.55 x VRP 1.15) |
| mid C4200 7d per unit | 64.867559 USDG |
| quoteBuy 10 C4200 | premi 725.585650 USDG @ sigma_buy 0.6718, fee 21.767570 |
| quoteBuy 1 P2600 | premi 1.300000 USDG = floor 5 bps x K (mid < floor) |
| reserved setelah beli | 44600.000000 USDG (10 x 4200 + 1 x 2600) |
| NAV setelah beli | 1000078.210042 USDG |
| settle @ S_T = 4500 | payout C4200 = 300/unit, P2600 = 0; bounty 2 USDG ke keeper |
| claim 10 C4200 | 3000.000000 USDG |
| NAV LP akhir | 997724.885650 USDG (= 1,000,000 + premi 725.585650 + 1.300000 - 3,000 - 2) |
| fee ke treasury (tidak masuk NAV) | 21.806570 USDG |
```
(`premi` = premium, `reserved setelah beli` = reserved after the buys, `NAV LP akhir` = final LP NAV, `fee ke treasury (tidak masuk NAV)` = fee to treasury, outside NAV.)

Quick liveness check without cloning anything (Foundry `cast` only):

```bash
RPC=https://sepolia-rollup.arbitrum.io/rpc
cast call 0xc331031a1730a567fd9149d5950912a1cdcb6a3e "sigmaBase()(uint256)" --rpc-url $RPC        # ≈ 5.5e17 = 0.55 (EWMA realized vol, WAD)
cast call 0xc331031a1730a567fd9149d5950912a1cdcb6a3e "sigmaMark(uint256)(uint256)" 0 --rpc-url $RPC # σ_mark(0) = σ_base × 1.15
# quote 1.0 × C 2600 (board 1, 2 Oct) on Pool B — seriesIds.B[2] of board 1; use board-0 ids only before Fri 25 Sep 07:59 UTC
cast call 0x7f79616217cc49edea777108b60981d7bf807cc9 \
  "quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))" \
  113041146249998727472278171105474209241162502845787322829231790148472690790096 1000000000000000000 --rpc-url $RPC
# → (premiumAssets, feeAssets [USDG 6 dp], sigma, delta, vegaTotal, spotWad); SeriesExpired from 60 s before expiry, SeriesSettled after settle
cast call 0x0000000000000000000000000000000000000071 "programTimeLeft(address)(uint64)" 0xb3b37050a40b9755001bddd29cc5df17a59f51d4 --rpc-url $RPC   # ≈ 3.15e7 s = 364 d on 2026-09-20
cast call 0x0000000000000000000000000000000000000072 "codehashIsCached(bytes32)(bool)" $(cast keccak $(cast code 0xb3b37050a40b9755001bddd29cc5df17a59f51d4 --rpc-url $RPC)) --rpc-url $RPC   # true
```

Owner-key paths (never for a judge; `.env` is git-ignored and was never tracked — `git log --all -- .env` is empty): `tools/demo/sepolia-demo.sh --check 1` (read-only parity block on board 1, prints the K5 rows to stdout, writes nothing); `--trade 1` (real trades on board 1, appends to `docs/DEMO_LOG.md`); `--claim` (Friday, board 0).

## C. MetaMask rehearsal for the video take (do it once on Thu 24 Sep, then for real on Fri 25 Sep)

Prerequisites: a MetaMask account used **only** for filming (not the owner key from `.env`). Fund it with ≈ 0.01 Sepolia ETH: `cast send ⟨filming-address⟩ --value 0.01ether --rpc-url $SEPOLIA_RPC_URL --private-key $SEPOLIA_PRIVATE_KEY` from the owner wallet (0.3649 ETH on 2026-09-20) — deterministic, no faucet queue — or the QuickNode faucet the panel links (`https://faucet.quicknode.com/arbitrum/sepolia`). One full pass (faucet, approve, deposit, buy, close, claim) costs well under 0.001 ETH at Sepolia's ≈ 0.1–0.14 gwei.

1. **Thu 24 Sep, before 23:00 UTC — buy a straddle on board 0 from the filming account** so Friday's `Claim` shows a non-zero payout whichever way ETH moves: Trade → Pool `B` → `Faucet 100,000 USDG` → `Approve USDG for pool B` → `Buy` `C 2600 #0 (25 Sep)` `0.1` → `Buy` `P 2600 #0 (25 Sep)` `0.1` (≈ 17 USDG of mock premium incl. fees on 2026-09-20 at spot ≈ 2576: call ≈ 7.1, put ≈ 9.6). Repeat on Pool `A` if the take should show both claims. One of the two pays ≈ |S_T − 2600| × 0.1 USDG; both pay 0 only if the settlement round prints exactly 2600.00 (a call also pays 0 above 5200 — `min(S_T − K, K)` — irrelevant here). The owner's existing positions (5 C 2800, 1 P 2400 on both pools) are claimed by `--claim` from the shell, not from MetaMask.
2. **Rehearsal pass (Thu), board 1 only:** `Deposit` `1000` USDG → preview `→ ≈ 999.9 shares` (NAV/share ≈ 1.0001; read it from the panel) → `Deposit`; `Buy` `C 2600 #1 (2 Oct)` `0.1` → preview `premium … + fee … = … USDG (max …) · σ … · Δ …` → `Buy` → MetaMask popup shows the `buy` call to `0x7f79…7cc9` with gas ≈ 1.5 × estimate → confirm → `✓ buy …` line with the Arbiscan link; `Close` `0.05` → `✓ close …`; `Redeem` → `max` → `Redeem`. Time each action with a stopwatch: Sepolia inclusion ≈ 1–3 s, MetaMask confirm ≈ 3–5 s, the panel's refresh ≤ 4 s with `?poll=4000` → ≈ 10 s per action. The 45-second trade section in `VIDEO_SCRIPT.md` therefore assumes **faucet + approve are done before the take** and shows deposit → buy → close with the idle seconds cut.
3. **Friday take (after Section D's settlement has landed and `--claim` has run):** open the dashboard fresh (`?poll=4000`), connect the filming account, scroll to `Volatility engine & NAV` — `Board #0 expiry … settled @ ⟨price⟩ (A) / ⟨price⟩ (B)` — then Trade → `Claim` → pick `C 2600 #0 (25 Sep) — 0.10 units` or `P 2600 #0 …` (whichever has payout > 0; the preview reads `0.10 units × ⟨payout⟩/unit = ⟨USDG⟩`) → `Claim` → `✓ claim …` → Activity shows `Claimed` on top and, above it, the keeper's `Settled` rows for both pools. Then the trade section on the **9 Oct board** (listed earlier that day) or board 1.
4. Wrong network: the button reads `Switch to Arbitrum Sepolia` and calls `wallet_switchEthereumChain` (adds the chain on error 4902) — rehearse it once so the take does not stall there.
5. Never type the owner key anywhere near the recording; the filming account holds only mock USDG and dust ETH.

## D. Friday 25 Sep 2026 — first real settlement (board 0, expiry `1790323200` = 08:00 UTC = 16:00 SGT = 15:00 WIB)

**Prerequisites — done by Wed 23 Sep at the latest** (`docs/OPS_SEPOLIA.md` › Prasyarat):
- [ ] PRs merged to `main` in order: #4 (pool) → #5 (Sepolia, stacked on #4) → Plan 3b (`feat/plan-3b`, 56 commits ahead of `main` on 2026-09-20, **not yet pushed**). `keeper.yml`, `pages.yml`, `tools/keeper/keeper.sh` and `deployments/arbitrum-sepolia.json` must be on `main` — GitHub only schedules cron and Pages from the default branch.
- [ ] Repo secret `KEEPER_PRIVATE_KEY` (+ optional `SEPOLIA_RPC_URL`) set — `DATA TIDAK DITEMUKAN` whether it exists (the packaging token cannot list secrets: HTTP 403); check `gh secret list --repo nodesproof/equinox` as the owner. The keeper wallet `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B` held 0.019977 ETH on 2026-09-20.
- [ ] **One green cron run observed** in Actions → `keeper` (not just `workflow_dispatch`): log has `poke: 0x…` and four lines `board 0/1 @ ⟨pool⟩: belum bisa settle (BoardNotExpired — expiry dalam N jam)` (= "cannot settle yet"). Local dry run any time: `DRY_RUN=1 KEEPER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001 tools/keeper/keeper.sh` (dummy key; only `cast call`/`estimate`).
- [ ] Pages live: `curl -I https://nodesproof.github.io/equinox/` → 200; badge `live`; Parity `✓` on 12 rows.
- [ ] Filming account's straddle bought (Section C step 1).

| Time (UTC) | What happens | Who / command |
|---|---|---|
| Thu 24 Sep 23:00 | last chance to buy board-0 positions (blackout starts 60 s before expiry, but keep margin) | filming account (Section C) |
| Fri 07:59:00 | Blackout: `quoteBuy`/`buy`/`close` on board-0 series revert `SeriesExpired` (`expiry ≤ now + 60 s`); NAV marks them at intrinsic; dashboard rows show `blackout/expired`; the gas line moves to board 1 | automatic |
| 08:00:00 | Expiry. `settle(0)` needs a Chainlink round with `updatedAt ≥ 1790323200` that is still fresh — usually lands 08:00–08:02 (feed cadence ≈ 1–2 min; heartbeat 120 s). Before it: `SettlementNotReady` | automatic |
| 08:00–08:15 | Keeper cron (`*/15`, GitHub jitter of a few minutes): `poke` → sequencer-mock check → `settle(0)` on **A then B** (two txs; each uses the freshest round at its own call — A ≠ B is legitimate, PRD §11 T2). Log: `board 0 @ 0x627b… : SETTLED 0x… ⟨gas⟩ → settled=true harga=⟨WAD⟩`. Bounty 2 USDG per settle to the keeper wallet | Actions → keeper |
| 08:20 | Verify: `cast call ⟨pool⟩ "board(uint256)(uint64,bool,uint256,uint256[])" 0 --rpc-url $RPC` → `true` + settlement price on both pools; dashboard `Board #0 expiry … settled @ … (A) / … (B)`; the board-0 reserve (16,400 + any Thursday straddle on that pool) is released; total `reserved` = remaining board-1 OI × K (≥ 130 USDG with the rehearsal's leftover 0.05 unit) plus judge positions | user |
| 08:30 | `tools/demo/sepolia-demo.sh --claim` from the owner: settles if the keeper has not (permissionless), prints the settlement price A/B, claims 5 C 2800 + 1 P 2400 on both pools (payout `min(S_T − 2800, 2800)` / `max(2400 − S_T, 0)` per unit — likely 0 unless ETH moved > 8.8 % up or > 6.8 % down from 2574; a 0 payout is still a real settlement: the escrow/reserve release is the event), appends to `docs/DEMO_LOG.md`; `git commit` the log | user (`.env` key) |
| 09:00 | **List the next boards** so quotes never stop: `tools/sepolia/list-boards.sh 1791532800:K1,K2,K3 1792137600:K1,K2,K3` (9 Oct and 16 Oct, both on the Friday-08:00 grid and ≤ 30-day tenor from 25 Sep; strikes ascending, whole USDG, **inside `[S/2, 2S]` at listing** — read `spot()` first, e.g. `2300,2600,2900` around S ≈ 2,600; the script fails hard otherwise). Writes `seriesIds`/`listTx` into `deployments/arbitrum-sepolia.json` → commit → Pages redeploys (`deployments/**` trigger) and the keeper reads the new boards. Open series after this: 6 (board 1) + 12 = 18 ≤ 32 (`maxOpenSeries`) | user (owner key) |
| 09:30 → | Record the video (Section C step 3; `VIDEO_SCRIPT.md`) | user |
| Fri 2 Oct 08:00 | Board 1 settles the same way (keeper); `--claim 1` afterwards if anyone holds board-1 positions. **Inside the T&C judging window (Oct 2–4): the 9 Oct board keeps `buy` alive** | keeper / user |
| 5–6 Oct | Keeper top-up ≈ 0.02 Sepolia ETH to `0x2e56…a89B` (one full-`poke` run = 82,815 gas × ≈ 0.136 gwei ≈ 1.13 × 10⁻⁵ ETH; 96 runs/day ≈ 1.1 × 10⁻³ ETH/day → runway ≈ 18 days from 20 Sep, `docs/OPS_SEPOLIA.md`) | user |
| Fri 9 Oct 08:00 | Board 2 settles; the 16 Oct board keeps quotes alive through HackQuest's `rewardTime` (Oct 12) | keeper |

Settlement-round fact for Q&A: `settle` uses whatever fresh round exists **when it is called** (not the first round after expiry) — accepted and documented (PRD §11 T2); the keeper is an accelerator, the 2 USDG bounty an incentive, not a guarantee.

## E. Murphy's-law fallbacks (one per live dependency)

| If this breaks | Symptom | Fallback (pre-wired) |
|---|---|---|
| PRs not merged in time | dashboard 404; keeper cron silent | `gh pr merge 4 --merge && gh pr merge 5 --merge` then push/merge `feat/plan-3b`; or `gh workflow run pages.yml` / `gh workflow run keeper.yml` after the merge (`workflow_dispatch` exists on both) |
| GitHub Pages / dashboard down | 404 or `connecting` badge forever | `cd web && npm ci && npm run dev` → `http://localhost:5173/equinox/` on the public RPC (same page, same data); screenshots from the pre-flight |
| Public RPC down / rate-limited | badge `stale`, banner `RPC unreachable — showing data fetched HH:MM:SS UTC` (the page keeps the last snapshot); events 429 on wide ranges | wait (the page retries every poll); for the take use a private RPC via a local proxy on loopback and `?rpc=http://127.0.0.1:8545`; `cast call` liveness lines against a second RPC |
| Keeper cron does not fire / fails | board expired, dashboard shows `expired — awaiting settle`; `buy` on that board `SeriesExpired` | (1) `gh workflow run keeper.yml`; (2) locally from the keeper wallet: `set -a; source .env; set +a; tools/keeper/keeper.sh`; (3) `tools/demo/sepolia-demo.sh --claim` settles permissionlessly from the owner. Named reverts `BoardNotExpired` / `SettlementNotReady` / `BoardAlreadySettled` / `OracleStale` are tolerated by the keeper (exit 0) |
| Someone flips `MockSequencerFeed` (open `set`) | quotes/deposits `OracleStale`, `settle` `SettlementNotReady` | keeper and `--claim` self-heal (`set(0, now − 7200)` when `answer ≠ 0` or grace re-armed); manual: `cast send 0x5154d98ac5c21aac01c0db923db484a7364139ff "set(int256,uint256)" 0 $(( $(date -u +%s) - 7200 )) --rpc-url $RPC --private-key ⟨any funded key⟩` |
| Chainlink Sepolia feed stalls (> 3 h: heartbeat 3600 × staleMult 3) | `OracleStale` on quotes/deposits; `withdraw`/`redeem` still work on a conservative NAV; `settle` waits | nothing to do but wait — this is the designed fail-closed path (PRD §3 G6); say so; show the Narrative table and the demo log meanwhile |
| Stylus program needs re-activation (ArbOS upgrade) or expires (365 d) | `buy`/`close`/`deposit` on Pool B revert `MathUnavailable`; Pool A unaffected | permissionless `cargo stylus activate`/`ArbWasm.activateProgram` (minutes); `claim`/`withdraw` keep working (FR-36); keeper prints `stylus programTimeLeft` every run (364 d on 2026-09-20 — not a risk in this window) |
| Judge's `buy` reverts | decoded before the wallet opens: `Reserve cap reached (80 % of the lagged capital reference)…`, `Vega cap reached…`, `Minimum size is 0.01 units.`, `Not enough USDG — use the faucet.` | the message is the answer; a 1,000,000 USDG seed per pool gives ≈ 226 ATM 7-day contracts of vega room (PRD §6.8) — nobody hits the cap with 0.1-unit trades |
| Out-of-gas on a `cast send` (the 20 Sep incident) | receipt `status 0`, `gasUsed == gasLimit` | fixed in `tools/sepolia/lib.sh` `send()` (1.5 × estimate, hard fail on status 0) and in `web/src/chain/wallet.ts` (`estimateContractGas × 1.5`); MetaMask users who override gas downward can still hit it — do not touch the gas field |
| Explorer down | address / tx links 5xx | `deployments/arbitrum-sepolia.json` carries every address and list tx; `docs/DEMO_LOG.md` carries every demo tx hash with gas; both in the public repo |
| Video upload rejected by HackQuest (no size/format rule published) | upload error | publish to YouTube (unlisted is fine) and paste the URL into `demoVideo`; keep the mp4 in `../../docs/assets/` |
| Judge asks "is that live?" during the video | — | every number on screen is a chain read; the take shows the block number in the header and the Arbiscan link of each tx; the demo log hashes match |

## F. Pre-flight checklist — day of submission (do all, in order)

- [ ] 1. **Merges done, Pages live, cron observed** (Section D prerequisites). Without this the form's field 1 is a 404 and T&C §3.3 is unmet.
- [ ] 2. Dashboard: badge `live`, `Chainlink ETH/USD … Xm ago` < 10 min, Parity `✓` on every live row, gas line shows both numbers, Trade panel lists open series (board 1 until 2 Oct 07:59 UTC, then the 9 Oct / 16 Oct boards), footer shows the mocks sentence and the build commit.
- [ ] 3. Settlement evidence: `docs/DEMO_LOG.md` has the 25 Sep `--claim` section with settlement prices A/B and the claim rows; `Board #0 … settled @` on the dashboard; `Settled`/`Claimed` rows in Activity.
- [ ] 4. Explorer: the address links in the README resolve; source verification — Sourcify done (12/12 exact match, 20 Sep, `tools/sepolia/verify.sh`; re-run it after any redeploy); Arbiscan still shows bytecode only unless verified with your own `ETHERSCAN_API_KEY` (optional, `RUBRIC_SCORECARD.md` rank 3); `cargo stylus verify` not run.
- [ ] 5. CI green on `main` (https://github.com/nodesproof/equinox/actions — last 15 runs on 19–20 Sep all `success`); `forge test` 87/0; `cargo test` 23; web `npm test` 33 passed; `npm run test:network` 3 passed (live parity).
- [ ] 6. Key hygiene: `git ls-files | grep -i '\.env$'` returns nothing; `git status` clean; the filming MetaMask account is not the owner; the keeper key lives only in the repo secret.
- [ ] 7. README ↔ form consistency: addresses in `SUBMISSION.md` match `deployments/arbitrum-sepolia.json`; README "Submission package ⏳ Plan 3b" row updated; README "~2,000 test vectors" fixed or knowingly accepted (generator emits 1,284 Rust vectors); commit count in field 5 refreshed.
- [ ] 8. Video: plays, ≤ 3:00, 1080p, the settlement section shows the real 25 Sep prices; uploaded to `demoVideo`.
- [ ] 9. HackQuest: registration complete; the second-project question answered by an organizer (or accepted knowingly); both prize tracks selected; every 300-char field pasted from `SUBMISSION.md` with the counter ≤ 300; sponsor checkboxes as decided (Part 3).
- [ ] 10. Submit before **2026-10-01 23:59 SGT** (T&C) — do not rely on the HackQuest Oct 4 date until an organizer confirms it in writing; screenshot the confirmation.

## G. What the judge will see on the dashboard, by date

| Window (UTC) | Boards open for `buy` | Series board rows | Notes |
|---|---|---|---|
| now → Fri 25 Sep 07:59 | #0 (25 Sep: 2400/2600/2800) and #1 (2 Oct: 2200/2600/3000) | 12 live rows, Parity `✓` × 12, gas line on board 0 C 2600 | best view for both boards; owner OI 5 C 2800 / 1 P 2400 visible in `OI A`/`OI B` |
| Fri 25 Sep 07:59 → ≈ 08:15 | #1 only | board-0 rows `blackout/expired`, Parity `—`; NAV panel `Board #0 … expired — awaiting settle` | ≤ 15 min unless the cron is late; `--claim` settles by hand |
| ≈ 08:15 → Fri 2 Oct 07:59 | #1, plus #2 (9 Oct) and #3 (16 Oct) once listed (Timeline 09:00) | board-0 rows `settled @ ⟨payout⟩/unit`; `Board #0 … settled @ ⟨price⟩ (A) / ⟨price⟩ (B)`; `Settled` + `Claimed` in Activity | the view most judges get under the T&C schedule (winners Oct 4) |
| Fri 2 Oct 08:00 → 9 Oct | #2, #3 | board-1 rows settle the same way | **if the 9/16 Oct boards were not listed, the Trade panel reads `no open series` and every row is settled — list them on 25 Sep** |
| 9 Oct → 12 Oct (HackQuest `rewardTime`) | #3 | — | keeper top-up 5–6 Oct keeps `Settled` rows arriving on time |

Judging calendar: under the T&C (deadline Thu Oct 1 23:59 SGT, winners Sun Oct 4 17:00 SGT) judges most likely open the links Fri Oct 2 – Sun Oct 4 SGT — board 1 settles Fri 2 Oct 16:00 SGT, mid-window, which is why the 9 Oct board must already exist. Under the HackQuest timeline (deadline Oct 4, winners Oct 12) judging runs Oct 5–12 — the 16 Oct board covers it. ETH/USD on Sepolia prints around the clock, so unlike Vigil there is no dead time of day: quotes, σ and parity are live 24/7; the only "boring" state is an unsettled expired board, which the keeper resolves within 15 minutes.

## Rehearsal log (REQUIRED before submission — 3 passes of path A, timed)

- [ ] Pass 1: ___ s (date/time UTC: ___, block: ___, Parity ✓ rows: ___/12)
- [ ] Pass 2: ___ s (date/time UTC: ___, block: ___, Parity ✓ rows: ___/12)
- [ ] Pass 3: ___ s (date/time UTC: ___, block: ___, Parity ✓ rows: ___/12)
- [ ] CLI path B run end-to-end on a clean clone: `forge test` ___ passed / ___ failed; `cargo test` ___; `onchain-check.sh` ___/20; Narrative numbers match the table above
- [ ] MetaMask pass on board 1 (Section C step 2): faucet ___ s · approve ___ s · deposit ___ s · buy ___ s · close ___ s · redeem ___ s (tx hashes: ___)
- [ ] Friday: settlement price A ___ / B ___ (round ids ___ / ___); `--claim` payouts C 2800 ___ / P 2400 ___; straddle claim from MetaMask ___ USDG (tx ___)
- [ ] Every row of section A confirmed on screen in a real browser (date: ___, commit shown in the footer: ___)
