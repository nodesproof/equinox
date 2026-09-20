# Equinox — Frontend Brief for an AI Builder

> **Audience:** an AI model (or engineer) asked to build a professional, production-grade frontend for Equinox.
> **Status of the facts in this file:** verified against the live deployment on **2026-09-20** (Arbitrum Sepolia block **310878195**, 13:03 UTC) and against the source on branch `feat/plan-3b` (commit `c7748a2`). Point-in-time values are marked *(at verification)*; never hard-code them — read them from the chain.
> **Language:** English on purpose (identifiers, ABI names and UI copy are English). The project's PRD and ops docs are in Indonesian; this brief is self-contained.

---

## 0. How to use this brief

1. **The contracts are frozen.** You are building a client. Do not propose contract changes; if a datum is missing on-chain, say so instead of inventing it.
2. **Every number on screen must have a source in §3 (Data inventory).** If it is not in §3 and you cannot derive it from §3 with the formulas in §4, it does not exist — show "—" with a reason, never a placeholder.
3. **Reuse the data layer.** `web/src/chain/*.ts` and `web/src/deployment.ts` are framework-agnostic TypeScript (viem 2) with unit tests. Keep them (or port them 1:1) as the single source of chain access; put your UI framework on top.
4. **Respect the behavioural contract in §5** (block-pinned snapshots, staleness, error isolation, executed-path slippage caps, click-time captures). These encode incidents that already happened on this deployment.
5. **Honesty rules in §7 are non-negotiable copy constraints** (testnet, mock USDG, "indicative" vs "executed", what K5 parity does and does not claim).
6. Acceptance is §9: your build is done when every check there passes against the live chain, not when it looks good.

Table of contents: §1 Product · §2 Live deployment facts · §3 Data inventory · §4 Formulas & units · §5 Behavioural contract · §6 Write paths (wallet) · §7 Honesty & copy rules · §8 Design & engineering requirements · §9 Acceptance checklist · Appendix A ABI surface · Appendix B current implementation map · Appendix C sample values.

---

## 1. Product in one page

**Equinox** is an on-chain options vault on Arbitrum. One contract (`EquinoxPool`) is simultaneously:

- an **ERC-4626 vault** — LPs deposit USDG (mock stablecoin, 6 decimals) and receive LP shares; the vault's capital backs every option it sells;
- an **options seller** — European, cash-settled **ETH calls and puts** as ERC-1155 series (one token id per `pool × expiry × strike × call/put`), organised in **boards** (one board = one Friday 08:00 UTC expiry with 3 strikes × {call, put} = 6 series);
- a **pricer** — Black-Scholes evaluated **on-chain** (`IBlackScholes`), with **endogenous volatility**: σ is not fed by a server. A shared `EquinoxVolEngine` observes Chainlink ETH/USD prints, maintains an EWMA of realised variance (`σ_base`), multiplies by a volatility-risk premium (VRP) and by an inventory term (utilisation of the pool's vega cap) to get `σ_mark(util)`; buy/close quotes add/subtract a spread.

Two identical pools are live so the Stylus claim can be checked publicly:

| | Pool A — control | Pool B — Equinox |
|---|---|---|
| Math contract | `BlackScholesSol` (Solidity + PRBMath) | Stylus program (Rust → WASM, cached) |
| Everything else | identical bytecode, identical config, **same** vol engine, **same** Chainlink feed | |

**K5 — the live identity claim is math parity, not quote parity.** For identical inputs (S, K, t, σ) both math contracts return byte-identical `(price, Greeks)` tuples. Pool *quotes* may legitimately differ because each pool's inventory (`netVega`) differs once trade histories diverge. Never present quote equality as a standing property.

Calls are **capped**: payout per unit `min(max(S_T − K, 0), K)` (priced as `C(K) − C(2K)`), so the vault's liability is finite and reservable (`reserved = Σ OI × K`). Solvency is hard: `reserved ≤ cash − escrow`.

Glossary: **WAD** = 1e18 fixed point · **USDG** = 6-dp asset (`assetScale = 1e12` converts to WAD) · **NAV** = `totalAssets()` · **OI** = open interest in units (WAD; 1 unit = 1 ETH notional) · **board** = expiry · **series** = one option token id · **blackout** = last 60 s before expiry (no trading) · **settle** = permissionless fixing of the settlement price after expiry · **claim** = burn settled units for payout · **poke** = make the engine observe the newest Chainlink round.

---

## 2. Live deployment facts (Arbitrum Sepolia)

Source of truth: [`deployments/arbitrum-sepolia.json`](../deployments/arbitrum-sepolia.json) (imported in the web build as `@deployment`). Contract sources are verified on Sourcify (12/12 exact matches, see `docs/VERIFICATION.md`).

| Item | Value | Source |
|---|---|---|
| Chain | Arbitrum Sepolia, chain id **421614**, ArbOS 116, Stylus v3 | manifest |
| Public RPC | `https://sepolia-rollup.arbitrum.io/rpc` (rate-limits wide `eth_getLogs`, HTTP 429) | manifest `rpc` |
| Explorer | `https://sepolia.arbiscan.io` (`/address/…`, `/tx/…`) | `deployment.ts` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` (viem's `arbitrumSepolia` chain has it) | viem |
| Pool A (control, `BlackScholesSol`) | `0x627b099c3e475f851d15ca9f261cd2f5b8b8be08` | manifest `pools.A.pool` |
| Pool A option token (ERC-1155) | `0xb275911e4d0af3640d48234d6f1cdce6f43aacc6` | `pools.A.token` |
| Pool B (Equinox, Stylus) | `0x7f79616217cc49edea777108b60981d7bf807cc9` | `pools.B.pool` |
| Pool B option token | `0x2ce0ead79441bf9e1bba8075aef031da98ed70d0` | `pools.B.token` |
| Math A — `BlackScholesSol` | `0x5B239AE1510AED1Bb21EB9d2e8A471D45720c4B3` | `blackScholesSol` / `pools.A.math` |
| Math B — Stylus program (cached) | `0xb3b37050a40b9755001bddd29cc5df17a59f51d4` | `blackScholesStylus` / `pools.B.math` |
| Shared `EquinoxVolEngine` | `0xc331031a1730a567fd9149d5950912a1cdcb6a3e` | `pools.vol` |
| Chainlink ETH/USD (**real** testnet feed, 8 dp, heartbeat 120 s, deviation 0.05 %) | `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` | `pools.feed` |
| `MockUSDG` (6 dp, open `mint` = faucet) | `0xbd1cb2556b5a2ad232f913a5390d57a7f35942c1` | `pools.usdg` |
| `MockSequencerFeed` (Sepolia has no L2 uptime feed) | `0x5154d98ac5c21aac01c0db923db484a7364139ff` | `pools.sequencerFeed` |
| Deployer contract (`PoolE2EDeployer`) | `0xeb64b16e491f82497ea545a65b3db3d3e6c92df3` | `pools.deployer` |
| Pools deployed at block / time | **310687948** · 2026-09-19T23:38:08Z | `pools.deployedAtBlock` |
| Owner & treasury of both pools and the engine | `0x90351bB1E85a17D5f70c62C0cC076D39D897076D` (seed-LP wallet; also used for the gas estimate) | `owner()`, `treasury()` |
| Keeper wallet (GitHub Actions cron, every 15 min, once `keeper.yml` is on `main`) | `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B` — 0.0200 ETH *(at verification)* | `docs/OPS_SEPOLIA.md` |
| Seed capital | 1,000,000 mock USDG per pool | `docs/DEMO_LOG.md` |
| Published dashboard | `https://nodesproof.github.io/equinox/` (GitHub Pages, Vite `base: '/equinox/'`, deploys from `main`) | `.github/workflows/pages.yml` |
| Repository | `https://github.com/nodesproof/equinox` | — |

### 2.1 Boards and series *(manifest; boards are appended every Friday after settlement)*

Series order inside a board is fixed by `EquinoxPool.createBoard`: `[C K0, P K0, C K1, P K1, C K2, P K2]`. Series ids differ per pool (`keccak256(abi.encode(pool, expiry, strikeWad, isCall))`, see §4.6) and are listed in the manifest under `boards[].seriesIds.A|B`.

| Board | Expiry (unix / UTC) | Strikes (USDG, whole numbers) | Status *(at verification)* |
|---|---|---|---|
| #0 | 1790323200 · Fri 2026-09-25 08:00 | 2400 · 2600 · 2800 | open — first live settlement |
| #1 | 1790928000 · Fri 2026-10-02 08:00 | 2200 · 2600 · 3000 | open |
| planned #2 / #3 | 1791532800 (9 Oct) · 1792137600 (16 Oct) | listed after 25 Sep | not yet on-chain |

**Do not hard-code board or series counts** (2 boards / 12 series today). Derive everything from the manifest; tests in `web/test/` are already state-agnostic for this reason.

### 2.2 Pool configuration *(identical on A and B; `cfg()` at verification)*

| Field | Value | Meaning |
|---|---|---|
| `feeBps` | 300 | fee = 3 % of premium, rounded up, paid to treasury |
| `maxUtilBps` | 8000 | reserve cap = 80 % of the lagged capital reference |
| `vegaCapBps` | 500 | vega cap = 5 % of the capital reference |
| `minPremiumBps` | 5 | premium floor = 0.05 % × K × size |
| `heartbeat` | 3600 s | oracle heartbeat assumed by the pool (∈ [1 h, 1 day]) |
| `staleMult` | 3 | spot stale when the round is older than 3 × heartbeat = 3 h → `OracleStale` |
| `sequencerGrace` | 3600 s | grace after sequencer restart |
| `maxOpenSeries` | 32 | listing cap |
| `tenorMax` | 2,592,000 s (30 d) | max board tenor |
| `minSize` | 1e16 (0.01 unit) | `SizeTooSmall` below this |
| `settleBounty` | 2,000,000 (2 USDG) | paid to whoever calls `settle` (if free liquidity allows) |
| `rWad()` | 0 | risk-free rate used in pricing |
| `CAP_MULT()` | 2e18 | capped call cap = 2 × K |
| `CAPITAL_REF_DELAY()` | 86,400 s | capital reference lag (1 day) |
| `assetScale()` / `priceScale()` | 1e12 / 1e10 | USDG→WAD and feed (8 dp)→WAD scales |

### 2.3 Vol engine parameters *(`params()` at verification; owner-changeable, rate-limited ≥ 6 h and ≤ 20 % per step)*

| Field | Value | Meaning |
|---|---|---|
| `lambdaPerDay` | 0.94 | EWMA decay per day |
| `vrp` | 1.15 | volatility-risk premium multiplier (∈ [1, 2]) |
| `alpha` | 0.30 | inventory sensitivity (∈ [0, 1]) |
| `spread` | 0.05 | ±5 % of σ applied on buy/close |
| `sigmaMin` / `sigmaMax` | 0.20 / 3.00 | σ_base clamp |
| `MIN_OBS_INTERVAL()` | 60 s | minimum spacing between observations |

The engine **only observes when something calls it**: `poke()` (keeper, anyone) or a trade/settle on either pool (`_pokeVol`). Between pokes `lastRoundId` lags the feed (96 rounds behind at verification, because the keeper cron only starts once its workflow is on `main`). This lag is the reason for the executed-path rule in §6.2.

---

## 3. Data inventory — what exists and where it comes from

Legend — **Cadence:** *snapshot* = every poll (15 s), pinned to one block; *derived* = computed client-side from snapshot fields; *events* = `eth_getLogs`; *static* = manifest/build. **Shown:** whether the current dashboard displays it (a "no" is an opportunity, not a gap in data).

### 3.1 Chain & session

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 1 | Block number, block timestamp | `client.getBlock()` (latest); all multicalls pass `blockNumber` | bigint / unix s | snapshot | yes (header) |
| 2 | Fetched-at, last-OK time, RPC error | client clock | ms | every poll | yes (live/stale badge, banner) |
| 3 | Staleness | `now − lastOk > 60 s` | bool | 1 s tick | yes |
| 4 | Build commit / build time | `__COMMIT__`, `__BUILD_TIME__` (Vite `define`) | string | static | yes (footer) |

### 3.2 Spot feed (Chainlink)

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 5 | `roundId, answer, startedAt, updatedAt, answeredInRound` | `AggregatorV3.latestRoundData()` on the feed | answer int256 **8 dp**; times unix s | snapshot | answer + age |
| 6 | `spotWad` | `answer × 1e10` | WAD | derived | used everywhere |
| 7 | Pool-side spot & freshness | `EquinoxPool.spot()` → `(priceWad, fresh)` (applies heartbeat×staleMult and sequencer grace) | WAD, bool | available, not read | no |
| 8 | Sequencer status | `MockSequencerFeed.latestRoundData()` (`answer` 0 = up, `startedAt`) | — | available | no |

### 3.3 Volatility engine (shared)

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 9 | `σ_base` | `EquinoxVolEngine.sigmaBase()` (clamped EWMA realised vol, annualised) | WAD | snapshot | yes |
| 10 | `σ_mark(0)` | `sigmaMark(0)` = σ_base × VRP | WAD | snapshot | yes |
| 11 | `σ_mark(u)` for any utilisation | `sigmaMark(utilWad)` | WAD | on demand | no |
| 12 | `varWad` | `varWad()` (EWMA variance) | WAD | snapshot | no |
| 13 | Params | `params()` → `(lambdaPerDay, vrp, alpha, spread, sigmaMin, sigmaMax)` | WAD each (uint64) | snapshot | vrp, alpha, spread |
| 14 | Last observation | `lastRoundId()`, `lastPrice()`, `lastTs()` | uint80, WAD, unix s | available | no (only in Observed chart) |
| 15 | Observation history | event `Observed(roundId, priceWad, dtSeconds, varWad, sigmaBase)` on the engine | — | events | yes (σ_base chart) |
| 16 | Param changes | event `ParamsUpdated(params)` | — | events | no |

### 3.4 Pool state (per pool, A and B)

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 17 | NAV | `totalAssets()` = cash − escrow − MtM liability of open options at σ_mark(0) (conservative `cash − escrow − reserved` when oracle/math is down) | USDG 6 dp | snapshot | yes |
| 18 | LP share supply | `totalSupply()` | 6 dp (shares) | snapshot | NAV/share |
| 19 | Reserved | `reserved()` = Σ OI × K over open series | WAD | snapshot | yes |
| 20 | Escrowed payouts | `escrowedPayouts()` (settled, unclaimed) | WAD | snapshot | yes |
| 21 | Net vega | `netVega()` | WAD | snapshot | yes |
| 22 | Free liquidity | `freeLiquidity()` = (cash − escrow − reserved)/1e12, floor 0 | USDG 6 dp | snapshot | yes |
| 23 | σ_mark(util) now | `sigmaMarkNow()` (mid, no spread; may revert when oracle stale → treat as null) | WAD | snapshot | yes |
| 24 | Capital reference | `capitalRefPrev()` (lagged, used for caps), `capitalRefCur()`, `capitalRefAt()` | WAD, WAD, unix s | snapshot (prev only) | prev |
| 25 | Trading paused | `tradingPaused()` | bool | snapshot | yes |
| 26 | Cash | `MockUSDG.balanceOf(pool)` | USDG 6 dp (stored ×1e12 as WAD in the snapshot) | snapshot | yes |
| 27 | Owner / treasury / pending owner | `owner()`, `treasury()`, `pendingOwner()` | address | snapshot (owner) | no |
| 28 | Config | `cfg()` (11 fields, §2.2) | mixed | available | no |
| 29 | Wiring | `math()`, `vol()`, `token()`, `feed()`, `sequencerFeed()`, `asset()` | address | available; `math()` asserted in network tests | footer (from manifest) |
| 30 | Constants | `CAP_MULT()`, `CAPITAL_REF_DELAY()`, `rWad()`, `assetScale()`, `priceScale()` | — | available | no |
| 31 | Board count / open series | `boardCount()`, `openSeriesIds()` | uint, uint[] | available | no |
| 32 | ERC-4626 limits & previews | `maxDeposit/maxMint/maxWithdraw/maxRedeem(addr)`, `previewDeposit/Mint/Withdraw/Redeem(x)`, `convertToAssets/Shares` | 6 dp | on demand | previewDeposit/Redeem |
| 33 | Lifecycle events | `Deposit`, `Withdraw`, `BoardCreated`, `TradingPaused`, `ConfigUpdated`, `TreasuryUpdated`, ownership events | — | events | no |

### 3.5 Boards & series

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 34 | Board | `board(id)` → `(expiry, settled, settlementPrice, seriesIds[])` | unix s, bool, WAD, uint[] | snapshot (per pool, per board) | expiry, settled, settlement price |
| 35 | Series | `series(id)` → `(boardId, expiry, strike, isCall, settled, oi, vegaAcc, payoutPerUnit)` | strike WAD, oi WAD, payoutPerUnit WAD | snapshot | oi, settled, payout |
| 36 | Buy quote | `quoteBuy(id, size)` → `(premiumAssets, feeAssets, sigma, delta, vegaTotal, spotWad)`; reverts with a named error when not quotable | premium/fee 6 dp; sigma WAD (**effective** σ: σ_buy or σ₀ when the clamp binds); delta WAD signed; vega WAD | snapshot for size = 1 unit; on demand for the user's size | premium (A, B, Δ), σ |
| 37 | Buy quote error | decoded custom error name (`SeriesExpired`, `OracleStale`, `SeriesSettled`, …) | string | snapshot | yes (status cell) |
| 38 | Close quote | `quoteClose(id, size)` → `(proceedsAssets, sigmaClose, spotWad)` | 6 dp, WAD, WAD | snapshot (1 unit) / on demand | proceeds |
| 39 | Series state | derived: `settled` → "settled @ payout/unit"; `expiry ≤ blockTime + 60` → "blackout/expired"; else open; board `expiry ≤ now` and not settled → "expired — awaiting settle" | enum | derived | yes |
| 40 | ATM series | derived: open calls on the nearest open expiry, strike closest to spot | ref | derived | highlighted row |
| 41 | Series label | derived: `C 2800 #0` / `C 2800 #0 (25 Sep)` | string | derived | yes |

### 3.6 Math parity (K5)

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 42 | Per live series: price tuples from both math contracts | call: `cappedCall(S, K, 2K, t, σ₀, 0)` → `(price, delta, vega)`; put: `quote(S, K, t, σ₀, 0, false)` → `(price, delta, gamma, vega, theta)`; on `MATH_SOL` and `MATH_STYLUS`, same block as the snapshot | WAD | after each snapshot | ✓ / ✗ / — |
| 43 | Parity verdict | full-tuple equality (bigint string compare, zero tolerance); `null` when either call failed | bool | derived | yes |
| 44 | Reference price | `priceSol` (WAD, per unit) — also used by the network test for the R3-a inequality `ceil(priceSol/1e12) ≤ buy.premium` and `close ≤ priceSol/1e12` | WAD | derived | no (only ✓) |
| 45 | Other math functions | `price`, `normCdf`, `normPdf`, `exp`, `ln`, `sqrt`, `impliedVol`, `ewmaUpdate`, `markPortfolio` on either math contract | — | on demand | no |

### 3.7 Gas

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 46 | Gas of `buy(1 unit)` A vs B | `estimateContractGas(buy(atmId, 1e18, MAX))` from `owner()` (has USDG + allowance); ratio A/B | gas units | after each snapshot | yes (one line) |
| 47 | Per-tx gas used | receipts (`gasUsed`) of the user's own transactions | gas | on demand | no |
| 48 | Benchmark numbers (loops 2.6–2.9× cheaper on Stylus, single calls ≈ 1×; I256 ≈ 3× pricier) | `docs/BENCHMARK.md` (devnode + Sepolia, measured) | text | static | link only |

### 3.8 Events / activity

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 49 | Trades | `Bought(seriesId, trader, size, premiumAssets, feeAssets, sigmaBuy, spotWad)`, `Closed(seriesId, trader, size, proceedsAssets, sigmaClose, spotWad)` on **both** pools | size WAD, assets 6 dp, σ WAD | events (delta every 4th poll) | yes (table) |
| 50 | Settlement | `Settled(boardId, settlementPriceWad, escrowedAddedWad, reservedReleasedWad)` | WAD | events | yes |
| 51 | Claims | `Claimed(seriesId, holder, amount, payoutAssets)` | WAD, 6 dp | events | yes |
| 52 | Observations | `Observed(...)` on the engine (§3.3 #15) | — | events | chart |
| 53 | Listings | `BoardCreated(boardId, expiry, seriesIds)` | — | available | no |
| 54 | Event seed | `public/events-seed.json` → served at `${BASE_URL}events-seed.json`; schema `{ lastBlock: string, generatedAt: ISO, trades: TradeEvent[], observed: ObservedEvent[] }` with bigints as decimal strings; rejected if `lastBlock < deployedAtBlock`; missing/invalid → full scan | JSON | static (build; Pages rebuilds daily 04:23 UTC) | yes (cold start) |
| 55 | Scan constraints | `eth_getLogs` in **50,000-block windows**, inclusive, per address; 3 addresses in parallel, windows sequential; ~0.3 s per window on the public RPC, wider ranges 429 | — | — | — |

### 3.9 Connected account

| # | Datum | Source | Type / unit | Cadence | Shown |
|---|---|---|---|---|---|
| 56 | Address, chain id | EIP-1193 `eth_requestAccounts`, `accountsChanged`, `chainChanged` | — | wallet events | yes |
| 57 | USDG balance | `MockUSDG.balanceOf(account)` | 6 dp | snapshot (with account) | yes |
| 58 | USDG allowance per pool | `MockUSDG.allowance(account, pool)`; "approved" when ≥ 1e12 (1,000,000 USDG) | 6 dp | snapshot | yes |
| 59 | LP shares per pool | `EquinoxPool.balanceOf(account)` | 6 dp | snapshot | yes |
| 60 | Option positions | `EquinoxOptionToken.balanceOf(account, seriesId)` for every series, per pool | WAD units | snapshot | yes |
| 61 | Claimable payout | derived: `position × payoutPerUnit / 1e18 / 1e12` for settled series | 6 dp | derived | preview |
| 62 | Redeemable now | `maxRedeem(account)` / `previewRedeem(shares)` | 6 dp | on demand | preview only |
| 63 | Native ETH balance (gas) | `client.getBalance(account)` | wei | available | no |
| 64 | Own history | filter `Bought/Closed/Claimed` by `trader`/`holder` = account (already in #49–51) | — | derived | no (tx hash tooltip only) |

### 3.10 Off-chain references (static)

| # | Datum | Where |
|---|---|---|
| 65 | Sepolia ETH faucet link | `https://faucet.quicknode.com/arbitrum/sepolia` |
| 66 | Docs to link | `docs/BENCHMARK.md`, `docs/DEMO_LOG.md`, `prd-arsitektur.md`, `docs/OPS_SEPOLIA.md`, `docs/VERIFICATION.md` (all on GitHub `main`) |
| 67 | Brand tokens (current) | dark `#0b1220`, panel `#111a2b`, line `#22304a`, text `#e6edf7`, muted `#8fa0bb`, gold `#f2c94c`, ok `#4cd28a`, warn `#f0a35c`, bad `#f06a6a`; fonts Instrument Sans (UI) + Martian Mono (numbers); favicon = gold ring on dark |

---

## 4. Formulas and units (client-side derivations that are allowed)

All formulas below mirror the contract code; they are the only client-side maths permitted for displayed numbers.

4.1 **Scales.** USDG (6 dp) → WAD: `× 1e12` (`assetScale`). Feed (8 dp) → WAD: `× 1e10` (`priceScale`). Percent from WAD: `x / 1e16`.

4.2 **σ_mark(u)** `= clamp(σ_base) × vrp × (1 + alpha × u)` (all WAD). Check *(at verification)*: 0.5483 × 1.15 = 0.6306 = `sigmaMark(0)`; × 1.30 = 0.8197 = `sigmaMark(1e18)`.

4.3 **Utilisation and caps (per pool).** `live = max(cash − escrow, 0)`; `capForCaps = min(live, capitalRefPrev)`; `vegaCap = capForCaps × 500 / 10000`; `util = clamp(netVega / vegaCap, 0, 1)` (cap 0 → util 1). Reserve cap: `reserved ≤ capForCaps × 8000 / 10000` (a buy that would exceed it reverts `UtilizationExceeded`).

4.4 **Quotes.** Buy: `σ_buy = σ_mark(util after trade) × (1 ± spread)` (sign follows the unit's vega at σ₀; `+` normally), per-unit price clamped `≥ p0` where `p0` = price at σ_mark(0) (R3-a "the pool never sells below its mark"); premium ≥ `K × size × 5 / 10000`; `fee = ceil(premium × 300 / 10000)`. Close: `σ_close = σ_mark(util after close) × (1 ∓ spread)`, price clamped `≤ p0`. Hence **`quoteBuy ≥ p0 ≥ quoteClose`** always. Call price = `C(K) − C(2K)` (capped), put = plain Black-Scholes; `r = 0`.

4.5 **Time to expiry.** `t_WAD = (expiry − blockTime) × 1e18 / 31536000`; series are untradeable when `expiry ≤ blockTime + 60`.

4.6 **Series id.** `uint256(keccak256(abi.encode(address pool, uint64 expiry, uint128 strikeWad, bool isCall)))` — implemented in `deployment.ts:seriesId()`; equals `EquinoxOptionToken.seriesId`.

4.7 **NAV decomposition.** `MtM liability = cash − escrow − NAV×1e12` (WAD); `NAV/share = totalAssets / totalSupply` (both 6 dp → plain ratio).

4.8 **Payout per unit** (set at settle, WAD): call `min(max(S_T − K, 0), K)`, put `max(K − S_T, 0)`. Claim pays `amount × payoutPerUnit / 1e18 / 1e12` USDG.

4.9 **Slippage caps (write path, §6.2).** `maxPremiumAssets = (premExec + feeExec) × 10100 / 10000` (floor); `minProceedsAssets = proceedsExec × 9900 / 10000`; `feeExec = feeQuote × premExec / premQuote + 1` (0 quote → feeQuote).

4.10 **Relative difference** (Δ column): `|a − b| / max(a, b)` as `x.xe-y`; "0" when equal.

4.11 **Gas ratio.** `gasA / gasB` from `eth_estimateGas` of the same call; not a measurement of execution — label it as an estimate.

---

## 5. Behavioural contract (keep these; each one encodes an incident)

| Rule | Why |
|---|---|
| **One snapshot per poll, all reads pinned to the same `blockNumber`** via multicall (`allowFailure: true`) | mixing blocks makes NAV/quotes/parity inconsistent; parity must compare at the snapshot block |
| Poll every **15 s** (`?poll=<ms>` ≥ 2000 override), exponential back-off on failure (30 s, 60 s max), `stale` after **60 s** without success, banner "RPC unreachable — showing data fetched HH:MM:SS UTC" **while keeping the last good data on screen** | public RPC hiccups must not blank the page |
| Parity, gas and events are fetched **after** the snapshot, each in its own try/catch; a failure only affects its own panel | never let a secondary read fail the primary refresh |
| Events: load the build-time seed first, then read only `lastEventsBlock + 1 … snapshotBlock` on the first successful snapshot and every **4th** refresh; merge with dedupe on `(tx, logIndex)` (`(block, logIndex)` for Observed), **newest read wins**; trades newest-first, observations chain order | cold scan from the deploy block hits 429 and takes seconds; the seed can be older than the chain |
| Optional reads (`sigmaMarkNow`, `quoteBuy`, `quoteClose`, user reads) fail soft → `null` + decoded error name; required reads (`latestRoundData`, `params`, `totalAssets`, …) fail the snapshot | show *why* a quote is missing (`SeriesExpired`, `OracleStale`) instead of a blank |
| `?rpc=` override accepted only for `127.0.0.1` / `localhost` | never let a link redirect a user's reads to a hostile RPC |
| Previews: 250 ms debounce + monotonically increasing sequence number per field; a stale response never overwrites a newer one; rebuild `<select>` options only when the list changed | 15-s snapshots re-render while a user types/opens a dropdown |
| Wallet actions: capture `pool` and `account` **at click time**, run size guards before any RPC, one action at a time (`busy`), re-read the snapshot with the account after connect and after every action (success or failure) | a radio/account change mid-await once targeted the wrong pool |
| Write = `simulateContract` (public RPC, decode revert before the wallet opens) → `estimateContractGas × 1.5` (fallback: let the wallet estimate) → `writeContract` → `waitForTransactionReceipt` (3 min) → require `status === 'success'`; sent-but-failed/timeout/receipt-lookup errors surface as `TxFailed(message, hash)` **with the explorer link** | Nitro's estimate has ~2–3 % margin and a new Chainlink round between estimate and inclusion adds an SSTORE; `cast send`/wallets report status-0 receipts as "sent" |
| Chain handling: switch to 421614; **4902** → `wallet_addEthereumChain` then switch; **4001** → "Switch to Arbitrum Sepolia to continue"; listen to `accountsChanged([])` (disconnect) and `chainChanged` | MetaMask users often lack the network |
| Read-only without a wallet: everything except writes works; previews still work with view quotes | judges/viewers without MetaMask |
| Series/board counts are **never** hard-coded; UI and tests derive from the manifest | boards are listed weekly; positions become 0 after claim |

---

## 6. Write paths (wallet)

All calls target Arbitrum Sepolia; the ABIs are in `web/src/abi/*.ts` (generated — never hand-edit). Pure call builders live in `web/src/chain/trade.ts`.

### 6.1 Actions

| Action | Contract call | Preconditions (checked by simulation) | Notes |
|---|---|---|---|
| Faucet | `MockUSDG.mint(account, 100_000e6)` | none (open mint) | mock money, no value |
| Approve | `MockUSDG.approve(pool, MAX_UINT)` | — | shown when allowance < 1,000,000 USDG |
| Deposit | `EquinoxPool.deposit(assets6dp, account)` | allowance, balance, `MathUnavailable` when math/oracle down, `maxDeposit` | preview `previewDeposit(assets)` → shares |
| Redeem | `EquinoxPool.redeem(shares, account, account)` | `maxRedeem` (free liquidity) | `withdraw(assets, …)` also exists; preview `previewRedeem(shares)` |
| Buy | `EquinoxPool.buy(seriesId, sizeWad, maxPremiumAssets)` → returns `premiumAssets` | size ≥ 0.01, series open (not blackout/settled), allowance/balance for premium + fee, `UtilizationExceeded`, `VegaCapExceeded`, `OracleStale`, `TradingIsPaused`, `SlippageExceeded` | mints ERC-1155 units to the buyer |
| Close | `EquinoxPool.close(seriesId, sizeWad, minProceedsAssets)` → `proceedsAssets` | position ≥ size (`ERC1155InsufficientBalance`, selector `0x03dee4c5` bubbles from the token), series open | burns units, pays USDG |
| Claim | `EquinoxPool.claim(seriesId, amount)` → `payoutAssets` | series settled (`NotSettled`) | never pausable |
| Settle (permissionless, optional UI) | `EquinoxPool.settle(boardId)` | board expired, fresh round with `updatedAt ≥ expiry` (`SettlementNotReady`) | caller receives 2 USDG bounty; the keeper does this every 15 min |
| Poke (permissionless, optional UI) | `EquinoxVolEngine.poke()` → σ_base | new round available and ≥ 60 s since last | ~83k gas *(measured 2026-09-20)*; refreshes quotes for everyone |

### 6.2 Executed-path caps (Important — do not regress)

`buy` and `close` call `_pokeVol()` **before** pricing, so they execute at the σ of the **newest** Chainlink round. `quoteBuy`/`quoteClose` are views at the **last observed** round. With an unpoked engine the two differ by more than the 1 % slack (reproduced live: view 6.707523 vs executed 6.638738 USDG, −1.03 %), so caps computed from view quotes revert `SlippageExceeded` and "retry" cannot help. Therefore, right before writing:

1. `premExec = simulateContract(buy(id, size, MAX_UINT), { account }).result`
2. `feeExec = scaleFee(feeQuote, premQuote, premExec)` (ratio from a fresh `quoteBuy(id, size)`)
3. `maxPremiumAssets = maxPremium(premExec, feeExec)`; for close: `proceedsExec = simulateContract(close(id, size, 0)).result`, `minProceedsAssets = minProceeds(proceedsExec)`.

UI copy: the board/preview quote is **"indicative"**; when a wallet is connected show **"executed ≈ X (max/min Y)"** from the simulation. Simulation failures in previews (no allowance, 429) must not hide the indicative quote.

### 6.3 Revert → human text (must be preserved verbatim or improved, never dropped)

| Error | Text |
|---|---|
| `OracleStale` | Spot is stale (Chainlink round older than 3 h or sequencer grace) — quotes are refused until a fresh round. |
| `UtilizationExceeded` | Reserve cap reached (80 % of the lagged capital reference) — new LP capital counts after 1–2 days. |
| `VegaCapExceeded` | Vega cap reached (5 % of the capital reference). |
| `SlippageExceeded` | Price moved beyond 1 % slippage — refresh and retry. |
| `SeriesExpired` | Series is in the 60-second blackout or expired — wait for settlement, then claim. |
| `SeriesSettled` | Series is settled — use claim. |
| `SizeTooSmall` | Minimum size is 0.01 units. |
| `TradingIsPaused` | Trading is paused by the owner (close/claim/withdraw still work). |
| `MathUnavailable` | Math program unavailable — deposits are refused until it is back (withdrawals still work). |
| `NotSettled` | Board not settled yet. |
| `ERC20InsufficientBalance` | Not enough USDG — use the faucet. |
| `ERC20InsufficientAllowance` | Approve USDG for this pool first. |
| `ERC4626ExceededMaxRedeem` | Not enough LP shares (or the pool cannot free that much liquidity right now) — redeem fewer shares. |
| `ERC4626ExceededMaxWithdraw` | The pool cannot free that much liquidity right now — withdraw less. |
| `ERC4626ExceededMaxDeposit` | Deposit exceeds the pool's maximum right now. |
| `ERC1155InsufficientBalance` (selector `0x03dee4c5`) | Not enough option units in your wallet for this series — close or claim at most your position. |
| other | `Reverted: <name>` / viem `shortMessage` (e.g. "User rejected the request.") |

The full error list per contract is in Appendix A; `SettlementNotReady`, `BoardNotExpired`, `BoardAlreadySettled`, `TooManySeries`, `BadExpiry`, `BadStrike` matter only if you expose settle/list.

---

## 7. Honesty and copy rules

1. **Testnet, always visible.** "Arbitrum Sepolia · 421614" in the chrome; USDG is a **mock** with an open faucet; the sequencer feed is a mock; the price feed is the **real** Chainlink testnet feed. No "$" values implying real money.
2. **Indicative vs executed** (§6.2) — never show a single "price" for a trade without saying which it is.
3. **K5 wording:** "both math contracts return byte-identical prices for identical inputs" ✓; "pool quotes are identical" ✗ (they differ by inventory). The Δ column is inventory, not math.
4. **Gas wording:** the A/B line is an `eth_estimateGas` comparison of one `buy`; single calls are ≈ 1× (0.99–1.08×). The 2.6–2.9× figure is for loop-heavy benchmarks in `docs/BENCHMARK.md` only. Stylus numbers are with the program **cached**.
5. **No fabricated data**: no demo mode with synthetic prices, no cached numbers presented as live (stale state must be visible), no rounding that hides a difference (6 dp for USDG quotes, 4 for σ).
6. **Time in UTC** with explicit "UTC"; expiries are Fridays 08:00 UTC; countdowns from block time, not wall clock, when they gate actions (blackout).
7. Explorer links for every address and tx hash; the user's own address links to Arbiscan.
8. Secrets never enter the frontend: no private keys, no API keys; the only RPC is the public one (or a loopback override).

---

## 8. Design and engineering requirements for the new frontend

### 8.1 Information architecture (recommended)

1. **Overview** — spot + age, σ_base / σ_mark(0) / VRP / spread, both pools' NAV, free liquidity, utilisation, next expiry countdown, live/stale/block indicator.
2. **Boards** — one table per board (rows = strike × C/P): buy/close per pool, Δ, parity ✓, OI, σ_buy; row states (open / blackout / expired-awaiting-settle / settled @ payout); ATM highlight; expandable Greeks (delta, vega, effective σ) from `quoteBuy`.
3. **Trade** — pool switch, series picker, size, indicative + executed preview, max/min cap, approve state, one-action-at-a-time, tx log with explorer links and decoded reverts.
4. **Portfolio** (connected) — USDG, LP shares per pool (with NAV/share × shares = value), positions per series with current close value (`quoteClose(id, position)`) and claimable payout, own trade history (#64), allowance state.
5. **Activity** — event feed (both pools, filter by pool/kind/mine), σ_base chart with time axis from `Observed` (block → time via the snapshot or block lookups), settlement markers.
6. **Contracts / About** — addresses (§2) with explorer links, config (§2.2/2.3) read live, build commit, links to docs, Sourcify status.

### 8.2 States every view must design for

loading (skeleton, no fake numbers) · live · stale (badge + banner, data kept) · RPC error on first load (retry + explanation) · no wallet · wrong network · account without USDG/allowance · trading paused · oracle stale (`OracleStale` on quotes) · math unavailable (`MathUnavailable`) · blackout · expired-awaiting-settle · settled (claim) · no positions · seed 404 (fallback scan in progress) · long event scan (progress) · tx pending / confirmed / reverted / timeout.

### 8.3 Numbers and formatting

USDG: 2 dp for balances/NAV, **6 dp for quotes and payouts**; σ: 4 dp (3 in previews); Δ (delta): 2 dp; units: 2 dp (4 when < 0.01); percentages: 2 dp; feed: 2 dp USD; addresses `0x1234…abcd`; tx `0x12345678…`; ages "42 s ago / 3.5 min ago / 1.2 h ago / 2.0 d ago"; countdowns `1d 2h 3m` / `2h 3m` / `3m 4s`. Use tabular figures (monospace or `font-variant-numeric: tabular-nums`). bigint end-to-end; convert to `Number` only at the formatting boundary.

### 8.4 Engineering constraints

- Static site, no backend, no server-side secrets; must run from GitHub Pages under **`/equinox/`** (all asset URLs relative to `import.meta.env.BASE_URL` or the framework's equivalent) and locally under the same base.
- TypeScript strict; viem ≥ 2.21 (already used; `arbitrumSepolia` chain object, multicall, `simulateContract`, `custom(window.ethereum)`); if you add a framework, keep `web/src/chain/*` as the data layer (or port it with identical semantics and keep its tests green).
- ABIs come from `npm run abi` (Foundry artifacts → `src/abi/*.ts`); CI fails on drift.
- Keep the existing test intent: manifest shape, series-id derivation, ABI surface, formatting, ATM pick, event chunking/labels/merge, trade cap maths (33 unit tests today) and the 3 network tests (parity rows, `math()` addresses, R3-a inequalities, user path). Add component tests for states in §8.2 and a stub-provider e2e (provider answers `eth_requestAccounts`/`eth_chainId`, rejects `eth_sendTransaction` with 4001 — nothing must ever sign in CI).
- Performance budget: first snapshot painted ≤ 3 s on a cold load over the public RPC (today ≈ 2.4 s); total JS ≤ 250 KB gzip (today 108 KB, viem-dominated); no layout shift when the 15-s refresh lands; no more than 3 multicalls + parity + gas per refresh (today: core, series, user, parity, 2 gas estimates) — batch, don't fan out.
- Accessibility: WCAG 2.1 AA contrast, full keyboard operation, focus states, `aria-live="polite"` for the tx log and the live/stale badge, tables with proper headers, reduced-motion respected, 375 px wide usable without horizontal page scroll (tables may scroll inside their card).
- Security: no third-party scripts or trackers; CSP-compatible (no inline eval); external links `rel="noopener"`; never place addresses/amounts in query strings other than the documented `?rpc=` (loopback only) and `?poll=`.
- Copy in English; UTC times; Indonesian is not needed in the UI.

---

## 9. Acceptance checklist (run against the live chain)

1. Every displayed pool/engine/feed value equals a `cast call` at the same block (spot-check NAV, reserved, σ_base, `sigmaMark(0)`, one `quoteBuy(id, 1e18)`, one `quoteClose`).
2. Parity ✓ on every live series; the parity call uses `t = (expiry − blockTime) × 1e18 / 31536000` and `σ = sigmaMark(0)` at the snapshot block.
3. Board rows show the correct state for: open, blackout (≤ 60 s to expiry), expired-awaiting-settle, settled (payout/unit = `series(id).payoutPerUnit / 1e12`).
4. Buy/close from a stub provider ends with "User rejected the request." and the calldata's cap equals `maxPremium(premExec, feeExec)` / `minProceeds(proceedsExec)` from a fresh simulation (compare with `cast call … buy(id,size,MAX) --from <account>`).
5. With the RPC blocked after a good load: stale badge within 60 s, banner text with the last-OK time, data still visible, polling resumes automatically.
6. Seed 404 (rename the file) → activity still fills from the full scan, no console errors, UI usable meanwhile.
7. Wallet on Ethereum mainnet → "Switch to Arbitrum Sepolia" path works, 4902 path adds the chain.
8. 375 px viewport: no page-level horizontal scroll; all actions reachable.
9. Lighthouse (mobile): Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95.
10. `npm run typecheck && npm test && npm run build` green; network tests green with `EQUINOX_NETWORK_TESTS=1`; no hard-coded board/series counts (grep).
11. Copy audit against §7 (testnet, mock USDG, indicative/executed, K5 wording, gas wording).

---

## Appendix A — ABI surface (from `web/src/abi/*.ts`, generated by `scripts/gen-abi.mjs`)

**AggregatorV3** — `latestRoundData() → (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`.

**BlackScholes (both math contracts, identical interface)** — `price(s,k,t,sigma,r,isCall) → uint256` · `quote(s,k,t,sigma,r,isCall) → (price uint256, delta int256, gamma uint256, vega uint256, theta int256)` · `cappedCall(s,k,cap,t,sigma,r) → (price, delta, vega)` · `impliedVol(target,s,k,t,r,isCall,lo,hi) → (sigma, iterations)` · `markPortfolio(s,r,sigma,capMult,k[],t[],isCall[],oi[]) → (value, vega)` · `ewmaUpdate(varPrev,pPrev,pNow,dtSeconds,lambdaPerDay) → var` · `normCdf`, `normPdf`, `exp`, `ln`, `sqrt`. Errors: `LengthMismatch`, `NoConvergence(uint8)`, `OutOfDomain(uint8)`, `Overflow`.

**EquinoxPool** (ERC-4626 + options) — views: `totalAssets, totalSupply, reserved, escrowedPayouts, netVega, freeLiquidity, sigmaMarkNow, capitalRefPrev/Cur/At, tradingPaused, owner, pendingOwner, treasury, cfg, rWad, CAP_MULT, CAPITAL_REF_DELAY, assetScale, priceScale, asset, math, vol, token, feed, sequencerFeed, spot, boardCount, board(id), series(id), openSeriesIds, quoteBuy(id,size), quoteClose(id,size), maxDeposit/maxMint/maxWithdraw/maxRedeem, previewDeposit/Mint/Withdraw/Redeem, convertToAssets/Shares`; writes: `deposit, mint, withdraw, redeem, buy, close, claim, settle`; owner: `createBoard, pauseTrading, setConfig, setTreasury, acceptOwnership`. Events: `Bought, Closed, Settled, Claimed, BoardCreated, Deposit, Withdraw, TradingPaused, ConfigUpdated, TreasuryUpdated, Transfer, Approval, OwnershipTransferStarted/Transferred`. Errors: `BadExpiry, BadStrike, BoardAlreadySettled, BoardNotExpired, BoardUnknown, ConfigOutOfBounds(uint8), MathUnavailable, NotSettled, OracleStale, SeriesExpired, SeriesSettled, SeriesUnknown, SettlementNotReady, SizeTooSmall, SlippageExceeded, TooManySeries, TradingIsPaused, UtilizationExceeded, VegaCapExceeded, ZeroAddress, ReentrancyGuardReentrantCall, SafeERC20FailedOperation` + OpenZeppelin ERC20/ERC4626/Ownable errors.

**EquinoxVolEngine** — views: `sigmaBase, sigmaMark(utilWad), varWad, spread, params, lastRoundId, lastPrice, lastTs, lastParamsUpdate, feed, math, owner, priceScale, MIN_OBS_INTERVAL, PARAMS_MIN_INTERVAL, MAX_PARAM_DELTA_BPS, MAX_ALPHA_DELTA`; writes: `poke() → uint256`, owner `setParams`. Events: `Observed(uint80 roundId, uint256 priceWad, uint256 dtSeconds, uint256 varWad, uint256 sigmaBase)`, `ParamsUpdated`. Errors: `BadFeed, ParamDeltaTooLarge(uint8), ParamOutOfBounds(uint8), ParamsRateLimited` + Ownable.

**EquinoxOptionToken** (ERC-1155) — `balanceOf(account,id)`, `balanceOfBatch`, `exists(id)`, `seriesId(pool,expiry,strike,isCall)` (pure), `pool()`, `deployer()`; pool-only `mint/burn`. Errors include `ERC1155InsufficientBalance(sender,balance,needed,tokenId)` (selector `0x03dee4c5`).

**MockUSDG** (ERC-20, 6 dp) — standard ERC-20 + open `mint(to, amount)`.

**MockSequencerFeed** — `latestRoundData()`, `answer()`, `startedAt()`, open `set(answer, startedAt)` (self-healed by the keeper/demo scripts if someone flips it).

---

## Appendix B — Current implementation map (`web/`, Vite 6 + TS 5 + viem 2, no framework)

| File | Responsibility |
|---|---|
| `src/deployment.ts` | manifest → typed constants (`POOLS`, `VOL`, `USDG`, `SEQ`, `FEED`, `BOARDS`, `ALL_SERIES`, `seriesId()`, `WAD`, explorer helpers, build metadata) |
| `src/chain/client.ts` | `createPublicClient` on `arbitrumSepolia` (15 s timeout, 1 retry); loopback-only `?rpc=` override |
| `src/chain/snapshot.ts` | `readSnapshot(client, account?)` — three multicalls pinned to one block; `Snapshot`/`PoolState`/`SeriesRow`/`UserState` types; `atmSeries()` |
| `src/chain/parity.ts` | `readParity(client, snapshot)` — K5 tuples on both math contracts; `yearsWad()` |
| `src/chain/gas.ts` | `readGas(client, snapshot)` — `estimateContractGas(buy)` A vs B from the owner |
| `src/chain/events.ts` | event ABIs, 50k-block `chunked()` scan, `readEvents`, `mergeEvents`, seed (de)serialisation + `loadSeed` |
| `src/chain/trade.ts` | pure call builders, `maxPremium`/`minProceeds`/`scaleFee`, constants (`MIN_SIZE`, `FAUCET_AMOUNT`, `ALLOWANCE_MIN`), `REVERT_TEXT`, `seriesLabel` |
| `src/chain/wallet.ts` | `connect`, `ensureChain` (4902/4001), `decodeRevert` + `REVERT_SELECTOR`, `executedBuy`/`executedClose`, `write()` (simulate → gas ×1.5 → write → receipt), `TxFailed`, `onWalletEvents` |
| `src/ui/poll.ts` | 15 s polling, back-off, `isStale` |
| `src/ui/format.ts` | number/time/address formatting, `relDiff` |
| `src/ui/svg.ts`, `src/ui/dom.ts` | dependency-free line chart, DOM helpers |
| `src/panels/*.ts` | header (badge/block), nav (engine + NAV cards), board (series table, parity, gas), trade (wallet panel), activity (events + σ chart), footer (contracts) |
| `src/main.ts` | wiring: seed → poll → snapshot → parity/gas/events → panels; account state |
| `scripts/gen-abi.mjs`, `scripts/seed-events.ts` | ABI generation; build-time event seed |
| `test/*.test.ts` | 33 unit tests; `parity.network.test.ts` (3, `EQUINOX_NETWORK_TESTS=1`); `smoke.network.test.ts` (real txs, `EQUINOX_SMOKE=1`, owner key) |
| `.github/workflows/pages.yml`, `ci.yml` | Pages deploy from `main` (push + daily 04:23 UTC + manual); CI `web` job + ABI drift check |

Run: `cd web && npm ci && npm run dev` → `http://localhost:5173/equinox/` (or `npm run build && npm run preview` → port 4173).

---

## Appendix C — Sample values *(block 310878195, 2026-09-20 13:03 UTC; for fixtures only, never for display)*

| Datum | Value |
|---|---|
| Chainlink ETH/USD | 2,579.49 USD (`answer` 257948518341), `updatedAt` 1789909342 |
| Engine `sigmaBase` / `sigmaMark(0)` / `sigmaMark(1e18)` | 0.5483 / 0.6306 / 0.8197 |
| Engine `varWad` / `lastPrice` / `lastTs` / `lastRoundId` | 0.3006 / 2,574.27 / 1789900003 / 18446744073710941823 (feed at 18446744073710941919) |
| Pool A / B `totalAssets` | 1,000,102.510411 / 1,000,103.157194 USDG (1,000,000 seed + fees) |
| Pool A `spot()` | (2579.485…e18, fresh = true) |
| Boards | 2; series 12; owner positions *(subject to Friday's claim)*: 5 × C 2800 #0 and 1 × P 2400 #0 on both pools |
| Keeper poke gas | 82,792 (tx status 1) |
| Cold load to first snapshot | ≈ 2.4 s; bundle 366 KB JS raw / 108 KB gzip |
