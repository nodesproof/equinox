# Acceptance — React dashboard vs `docs/FRONTEND_BRIEF.md` §9

**Result: 12/12 items pass** against the live Arbitrum Sepolia deployment. This is the gate of the fallback rule (Plan 5 spec Q2): GitHub Pages now deploys this app; the classic UI in `web/` stays one `workflow_dispatch` away (`target: classic`; the repository variable `PAGES_TARGET=classic` makes it stick).

**Run:** 22 Sep 2026, 22:24–22:35 UTC, blocks 311 692 907 – 311 696 553 (spot 2,744.60–2,748.64 USD, σ_base 0.5570, σ_mark(0) 0.6405; boards #0 = 25 Sep 2026 08:00 UTC and #1 = 2 Oct 2026 08:00 UTC, both open). **Build:** commit `79188ef`, `npm run build` (762 KB raw / 227 KB gzip JS), served by `vite preview` at `http://127.0.0.1:4174/equinox/` with a fresh seed (`generatedAt 2026-09-22T22:18:29Z`, `lastBlock 311692835`, 10 trades, 154 `Observed`). **Tools:** Playwright 1.61.1 (Chromium headless), Foundry `cast` 1.5.1, Lighthouse 12.8.2 on Chrome 149, the public RPC `https://sepolia-rollup.arbitrum.io/rpc` for both the app and `cast`. The drive scripts are not part of the repo (no Playwright/Lighthouse dependency here); what each one does is written out below.

Wallet flows use a **stub EIP-1193 provider** injected before the page loads: it answers `eth_requestAccounts`/`eth_accounts`/`eth_chainId`, forwards every read to the public RPC, and **rejects every `eth_sendTransaction` with `4001`** — nothing is ever signed. Accounts: the owner `0x9035…076D` (mock USDG, LP shares, one open position, Paxos USDG 9.74 with an allowance on Pool C) and the keeper `0x2e56…a89B` (no Paxos USDG, no allowance on C).

| # | Item | Verdict | Evidence (below) |
|---|---|---|---|
| 1 | Displayed values = `cast call` at the same block | ✅ | 71/71 equal at blocks 311 696 486 / 311 696 553 |
| 2 | Parity ✓ on every live series, t and σ as specified | ✅ | 12/12 live series, both math contracts reproduced with `cast` |
| 3 | Row states: open, blackout, expired-awaiting-settle, settled | ✅ | open observed live (2 boards, countdowns equal); the other three from fixture tests |
| 4 | Stub buy/close → "User rejected the request."; calldata cap = fresh simulation | ✅ | buy `maxPremiumAssets` 1 649 762, close `minProceedsAssets` 61 437 reproduced by `cast` inside the click window |
| 5 | RPC blocked after a good load | ✅ | stale badge, banner with the last-OK time, data kept, polling resumed on its own |
| 6 | Seed 404 → activity from the full scan, UI usable | ✅ | real 404 and SPA-fallback variants; events filled, UI live meanwhile |
| 7 | Wallet on mainnet → switch; 4902 → add chain | ✅ | 11/11 verdicts |
| 8 | 375 px: no page-level horizontal scroll, actions reachable | ✅ | 6 routes, 15/15 verdicts |
| 9 | Lighthouse mobile: Perf ≥ 90, A11y ≥ 95, BP ≥ 95 | ✅ | Perf 92–93, A11y 100, BP 96–100 on all six routes |
| 10 | typecheck + tests + build green, network tests green, no hard-coded counts | ✅ | app 152/152 at the run (158/158 after the final-review fixes), web 33/33 + 3/3 network, 227 KB gzip, grep clean |
| 11 | Copy audit against §7 | ✅ | 21/21 verdicts on the rendered text of 13 page states |
| 12 | Pool C: asset per pool, no mint, Paxos link, approve target, `InsufficientFunds()` decoded | ✅ | part of the 35/35 drive verdicts |

## 1. Values against `cast call` at the same block

Script: open Overview and Boards without a wallet, wait for `live`, read the block from the header (`block N`), then `cast call --block N` for every displayed value and format it with the app's own `web/src/ui/format.ts` (`usdg`, `usdg6`, `wad`, `fmtCountdown`, `relDiff`). **71/71 equal**, no console errors. Selection (block 311 696 486 for Overview, 311 696 553 for Boards):

| Value | UI | `cast` |
|---|---|---|
| ETH/USD — `feed.latestRoundData().answer` | 2,748.64 | 2,748.64 |
| σ_base — `vol.sigmaBase()` | 0.5570 | 0.5570 |
| σ_mark(0) — `vol.sigmaMark(0)` | 0.6405 | 0.6405 |
| Pool A NAV — `totalAssets()` | 1,000,001.73 USDG | 1,000,001.73 USDG |
| Pool A reserved — `reserved()` / 1e12 | 16,400.00 USDG | 16,400.00 USDG |
| Pool B NAV — `totalAssets()` | 1,000,002.37 USDG | 1,000,002.37 USDG |
| Pool C NAV — `totalAssets()` (Paxos USDG) | 90.26 USDG | 90.26 USDG |
| Buy B, C 2800 #0 (ATM) — `quoteBuy(id, 1e18).premiumAssets` | 38.245070 | 38.245070 |
| Close B, same series — `quoteClose(id, 1e18).proceedsAssets` | 32.784571 | 32.784571 |
| σ_buy A \| B \| C — `quoteBuy(...).sigma` | 0.6751 \| 0.6751 \| 0.8743 | 0.6751 \| 0.6751 \| 0.8743 |
| Δ A\|B — `relDiff(premium A, premium B)` | 1.5e-5 | 1.5e-5 |

The other rows: next-expiry countdown from block time, and per pool free liquidity, escrowed payouts, `sigmaMarkNow()`, `netVega()`, `capitalRefPrev()`, `asset.balanceOf(pool)`, NAV/share (`totalAssets/totalSupply`), `series(id).oi`, Close A/C, and the 12 row labels against the manifest order.

## 2. Math parity (K5)

Same run, block 311 696 553: for every live series the script computes `t = (expiry − blockTime) × 1e18 / 31 536 000` and `σ = sigmaMark(0)` at that block and calls `cappedCall(S, K, 2K, t, σ, 0)` (calls) or `quote(S, K, t, σ, 0, false)` (puts) on **both** `BlackScholesSol` and the Stylus program. **12/12 live series: the two return strings are identical and the UI shows ✓** (e.g. row 0: 344803022372587072879 on both).

## 3. Row states

Live: both boards are open — `board().settled = false`, expiry > block time + 60 s; the UI reads `open` for both and the pill countdown equals `fmtCountdown(expiry − blockTime)` ("open · expires in … (block time)"). Blackout, expired-awaiting-settle and settled cannot be produced on the live chain before 25 Sep 2026 08:00 UTC; they are rendered from the snapshot fixture (`withBlackout`, `withExpired`, `withSettled`) in `test/pages/boards.test.tsx`: "settled board: S_T per pool in the pill, "settled @ payout/unit" in the Buy columns …" (payout/unit = `series(id).payoutPerUnit / 1e12`), "blackout board shows "blackout" per series and the boards before it "expired — awaiting settle"", "expired board (not yet settled) reads "expired — awaiting settle" in the pill and every row". The first live settlement (25 Sep) is re-checked with the same script after the keeper settles.

## 4. Buy/close from the stub provider

Owner on Pool B, `#/trade`: *Connect wallet* → buy 0.01 × C 2600 #0 → *Buy*; then close 0.50 × P 2400 #0 → *Close*. Both log lines end with **"User rejected the request."** (`✗ buy 0.01 C 2600 #0 (25 Sep) on B — User rejected the request.`, `✗ close 0.50 P 2400 #0 (25 Sep) on B — User rejected the request.`); the provider saw `eth_sendTransaction` twice and never an `eth_sign*`. The calldata is decoded (selector = `cast sig "buy(uint256,uint256,uint256)"` / `"close(uint256,uint256,uint256)"`, series id and size as clicked) and its cap compared with `cast call --from <owner> --block b` over every block of the click window:

- **buy** — calldata `maxPremiumAssets` = **1 649 762**; at blocks 311 694 261–311 694 264 `cast` gives premExec 1 585 851 and fee 47 577 → `maxPremium` = (1 585 851 + 47 577) × 1.01 = **1 649 762**.
- **close** — calldata `minProceedsAssets` = **61 437**; at blocks 311 694 325–311 694 326 `cast` gives executedClose 62 058 → `minProceeds` = 62 058 × 0.99 = **61 437**.

## 5. RPC blocked after a good load

Load Overview, wait for `live`, then abort every request to the RPC host (Playwright `route.abort('connectionfailed')`, sampled every 5 s for 70 s): the badge turns **stale** at the 65-s sample (60-s rule + sampling); the banner reads "RPC unreachable — showing data fetched 22:25:22 UTC" in a `role=status` region; NAV, feed and block stay on screen; 16 requests were aborted (the poll kept retrying with back-off). After unblocking, the page was **live again 37 s later** (banner gone, block advanced 311 694 474 → 311 694 901) with no user action. 6/6 verdicts.

## 6. Seed 404

Two variants, each 3/3: **real 404** (the seed request answered `404` by Playwright routing — what GitHub Pages would return) and **renamed file** (`dist/events-seed.json` moved away; `vite preview` answers its SPA fallback, 200 HTML, which the loader rejects as "no seed"). In both, the badge is live and navigation and filter chips work before the scan ends, and Activity fills from the full chunked scan ("chain scan live"). Console: nothing in the renamed variant; in the real-404 variant the only line is Chromium's own network message for the missing file ("Failed to load resource: the server responded with a status of 404") — the browser prints it for any failed fetch; no application error, no `pageerror`.

## 7. Wrong network

Stub wallet on chain `0x1`: (A) *Connect* → the app calls `wallet_switchEthereumChain(0x66eee)` right after `eth_requestAccounts` and ends connected with balances read; (B) switch answers `4902` → `wallet_addEthereumChain` with chain id `0x66eee`, name "Arbitrum Sepolia", the public RPC and Arbiscan → second switch → connected; (C) `chainChanged(0x1)` while connected → pill "wrong network", topbar "Switch to Arbitrum Sepolia", trade buttons disabled, the last snapshot's balances stay visible; a rejected switch (`4001`) logs "Switch to Arbitrum Sepolia to continue"; a second click switches and restores the balances. No transaction or signature requested. 11/11 verdicts, no console errors.

## 8. 375 px

Viewport 375 × 812 on all six routes: `scrollWidth == innerWidth == 375` and no element past the right edge; every button/link inside the viewport (Overview 13, Boards 33, Trade 13, Portfolio 2, Activity 11, Contracts 54); the navigation drawer opens by tap with 7 items of 44 px; a series card's *Details* expands inside the viewport (291 px); Trade's primary buttons are full-width and 44 px tall (disabled without a wallet). 15/15 verdicts, no console errors.

## 9. Lighthouse (mobile)

`lighthouse <url> --only-categories=performance,accessibility,best-practices --form-factor=mobile --throttling-method=simulate --chrome-flags="--headless=new"`:

| Route | Performance | Accessibility | Best Practices | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| `/equinox/` (Overview) | 92 | 100 | 100 | 2.3 s | 2.9 s | 140 ms | 0.003 |
| `#/boards` | 93 | 100 | 100 | 2.3 s | 2.7 s | 100 ms | 0.003 |
| `#/trade` | 93 | 100 | 100 | 2.3 s | 2.7 s | 130 ms | 0.003 |
| `#/portfolio` | 93 | 100 | 100 | 2.3 s | 2.6 s | 130 ms | 0.003 |
| `#/activity` | 93 | 100 | 96 | 2.3 s | 2.7 s | 100 ms | 0.004 |
| `#/contracts` | 93 | 100 | 100 | 2.3 s | 2.7 s | 90 ms | 0.003 |

**Contrast, measured outside Lighthouse.** Panels and cards sit on gradient backgrounds, so axe marks their text contrast "incomplete" and Lighthouse does not score it — its 100 did not see that the tertiary text colour `#566681` (53 rules: table headers, form labels, footnotes, revert reasons) was only 2.65–3.22:1. The final review caught it; `test/lib/contrast.test.ts` now computes the WCAG ratio of every text colour in `index.css` against its own solid background or, without one, against every app surface (`#0b1220`, `#0e1726`, `#111a2b`, `#152036`, `#18253a`): the tertiary colour is `#7f8fa9` (4.69:1 on the lightest surface, 5.31:1 on panels), placeholders `#7f8fa9` on `#152036` (4.96:1), the letter on the violet pool badge `#101522` (6.99:1); only disabled controls and decorative icons keep `#566681` (WCAG 1.4.3 exemptions).

Activity's 96: the `font-size` audit counts 57.5 % of its text at ≥ 12 px (threshold 60 %; the chart note and axis labels are 9 px). Trade was 96 on accessibility before commit `79188ef` (unit-suffix contrast, and the *max* button's accessible name now starts with its visible text).

## 10. Build, tests, hard-coded counts

`npm run check` (tsc, client + tests + `../web/src`) clean; `npm test` **152/152** (14 files) at the run — **158/158** (15 files) after the final-review fixes (contrast, deployer vs live owner on Contracts, reduced-motion route scroll); `npm run build` → **762 KB raw / 227 KB gzip JS** (budget 250 KB, `scripts/size.mjs`). Data layer: `cd web && npm run typecheck && npx vitest run` → **33/33** (+4 skipped network/smoke), `EQUINOX_NETWORK_TESTS=1 npx vitest run test/parity.network.test.ts` → **3/3** (parity + `math()`/`asset()` per pool + R3-a; event scan since deploy; user path on every pool). Grep over `client/src`: no `0x…` addresses, no `BOARDS[n]`/`ALL_SERIES[n]`/`seriesIds…[n]` indexing, no board/series counts or expiry timestamps (the only dates are the "25 Sep 2026 · 08:00 UTC" format examples in comments). Workflows pass `actionlint` 1.7.7.

## 11. Copy (§7)

The rendered text (`innerText` plus every `title`/`aria-label`) of the six routes at 1400 px and at 375 px, and of Trade with the stub wallet connected, checked against §7 — 21/21: "Arbitrum Sepolia · 421614" on every route and width; "USDG on A/B is a mock; Pool C settles in Paxos USDG — testnet, no real money."; no "mainnet", "production USDG", no claim that USDG is absent from Sepolia, no `$` amounts; the sequencer named as a mock (`MockSequencerFeed (no L2 uptime feed on Sepolia)`) and the feed as Chainlink; trade previews "(indicative)" and "executed ≈ … USDG (max …)"; K5 as "both math contracts … return byte-identical prices for identical inputs", never "identical quotes"; Δ explained as inventory; no "10×", no "2.6–2.9×" outside the benchmark context; gas as `eth_estimateGas` with the Stylus program "cached"; times in UTC; never a bare "no oracle"; the Pool C footnote verbatim ("Pool C: same Stylus math and engine as B, settled in Paxos USDG (testnet); its inventory term (σ_mark(util)) follows its own pool size."). No console errors.

## 12. Pool C

`asset()` of every pool equals the manifest (A and B → mock `0xbd1c…42c1`, C → Paxos USDG `0xffc9…1892`). With Pool C selected there is no mint button and the `https://faucet.paxos.com/` link reads "Get 100 USDG/day at faucet.paxos.com". **Owner** (9.74 Paxos USDG, allowance set): buy 0.03 × C 2200 #1 (premium 16.463883 + fee 0.493917 = 16.957800 USDG) → "✗ buy 0.03 C 2200 #1 (2 Oct) on C — Not enough USDG in your wallet for this pool — Pool C uses Paxos USDG (get 100/day at faucet.paxos.com)." without opening the wallet; `cast call --from <owner>` of the same buy reverts with data `0x356680b7` = `cast sig "InsufficientFunds()"`. **Keeper** (allowance 0): buy → "Approve USDG (Paxos) for pool C first." (`InsufficientAllowance()`); *Approve USDG (Paxos) for pool C* → calldata `approve(address,uint256)` sent **to `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`** with spender = Pool C `0xebd255c8…872e92` and amount `MAX_UINT`, rejected by the stub ("User rejected the request."). The drive (items 4 and 12) ends 35/35 with no console errors.
