# Equinox

[![Dashboard](https://img.shields.io/badge/dashboard-nodesproof.github.io%2Fequinox-2ea44f)](https://nodesproof.github.io/equinox/) [![CI](https://github.com/nodesproof/equinox/actions/workflows/ci.yml/badge.svg)](https://github.com/nodesproof/equinox/actions/workflows/ci.yml) [![Sourcify](https://img.shields.io/badge/sources-verified%20on%20Sourcify%2012%2F12-blue)](https://repo.sourcify.dev/421614/0x7f79616217cc49edea777108b60981d7bf807cc9) [![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

**An options AMM for ETH on Arbitrum whose prices are computed entirely on-chain.**

Liquidity providers deposit [USDG](https://paxos.com/usdg/) and become the option writer; traders buy short-dated (7–30 day) European ETH calls and puts, cash-settled in USDG. The pool prices every trade itself with Black-Scholes executed on-chain in Rust via [Arbitrum Stylus](https://docs.arbitrum.io/stylus/gentle-introduction), using an implied volatility it **derives on-chain** — realized volatility from Chainlink observations plus inventory pressure. The only external input is the ETH spot price. Puts are fully reserved and calls have a capped payout, so the pool can never owe more than it holds.

Built for the Arbitrum Open House Singapore Online Buildathon (2026).

## Try it in 60 seconds

1. **Open the dashboard** — <https://nodesproof.github.io/equinox/> — no wallet, no key. It reads the live pools on Arbitrum Sepolia: the 12 series of both pools with quotes A | B side by side, the **Parity** column (✓ = the Solidity control and the Stylus program returned byte-identical prices for identical inputs at that block — decision K5), NAV, an `eth_estimateGas` line for `buy` on A vs B, and the activity feed with the σ_base chart from real Chainlink prints. Until the Plan 3b PR is merged to `main` the URL is 404 — run the same page locally: `cd web && npm ci && npm run dev` → <http://localhost:5173/equinox/>.
2. **Trade from MetaMask** on Arbitrum Sepolia (a little Sepolia ETH for gas — the panel links a faucet): *Connect wallet* → *Faucet 100,000 USDG* (mock, open mint) → *Approve* → *Buy*, e.g. 0.1 × C 2600 on board 1 (2 Oct) → *Close*, or *Claim* after the board settles. Every write is simulated first and a revert is decoded before the wallet opens; the panel prints the Arbiscan link of each transaction.
3. **No browser?** One `cast call` quotes a series directly from the pool (block below, "Live on Arbitrum Sepolia"), `tools/bench/onchain-check.sh deployments/arbitrum-sepolia.json` runs the 20 bit-exact checks against both math contracts, and `cd contracts && forge test` runs the 87 tests.

Submission package (Plan 3b): [`docs/SUBMISSION.md`](docs/SUBMISSION.md) (HackQuest form text, every field counted) · [`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md) · [`docs/JUDGE_QA.md`](docs/JUDGE_QA.md) · [`docs/RUBRIC_SCORECARD.md`](docs/RUBRIC_SCORECARD.md) · [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) · [`docs/OPS_SEPOLIA.md`](docs/OPS_SEPOLIA.md) (first real settlement, Fri 25 Sep 2026 08:00 UTC — scheduled, not done yet).

## Status

| Piece | State |
|---|---|
| Quant core: Black-Scholes + Greeks, capped call, implied-vol solver, EWMA volatility, batch mark-to-market — in Python (executable spec), Rust/Stylus (production) and Solidity (control), all **bit-identical** | ✅ done, tested, deployed to a local Nitro devnode, benchmarked |
| Stylus program `bs-stylus` (`cargo stylus check` passes on Arbitrum Sepolia) | ✅ done |
| Pool contracts: LP vault (ERC-4626), option series (ERC-1155), buy/close, settlement, claims, volatility engine, two-level factory | ✅ done — 87 Foundry tests in 9 suites (68 on the pool, vol engine, option token and oracle, incl. 7 invariants: 32 runs × depth 128 in CI, 256 × 200 = 51,200 calls each in the long run; 12 on the math control; 3 on the factory's shared-engine path, 3 on the E2E deployer, 1 deterministic §13 narrative), 93.4 % line coverage on `src/pool` + `src/oracle` (428/458 lines), three audit rounds plus a final fix wave; two identical pools (control vs Stylus) verified byte-identical on a devnode |
| Math on Arbitrum Sepolia: Stylus program (cached), Solidity control and `Bench` | ✅ deployed 20 Sep 2026 — 20/20 on-chain exactness checks; cached-program gas measured directly and equal to the devnode-derived column; addresses in `deployments/arbitrum-sepolia.json` |
| Pools live on Sepolia (real Chainlink feed, shared vol engine, keeper, demo log) | ✅ 20 Sep 2026 — two pools, two boards, 12 series each; math parity verified on-chain (20/20 exactness checks on both `math` addresses); the demo's opening quote was byte-identical on both pools at block 310700824; pool quotes may since differ through the inventory term of σ_mark once trade histories diverge; every demo tx (incl. one out-of-gas, post-mortem included) in `docs/DEMO_LOG.md` |
| Dashboard + wallet trading | ✅ <https://nodesproof.github.io/equinox/> (live after the PRs merge; read-only without a wallet; trade with MetaMask on Arbitrum Sepolia) — Vite + viem, 33 unit tests + 3 network tests + a headless write smoke test |
| Source verification | ✅ 12/12 Solidity contracts on Sepolia verified on Sourcify (exact match, 20 Sep 2026) — see "Source verification" below |
| Submission package | ✅ written 20 Sep 2026 (form text, video script, judge Q&A, scorecard, runbook — links above); ⏳ video not recorded yet; ⏳ first real settlement Fri 25 Sep 2026 08:00 UTC; ⏳ submit by 1 Oct 2026 15:59 UTC (T&C date; HackQuest shows 4 Oct) |

The pricing engine and the pool are implemented, verified and live on Arbitrum Sepolia (next section); the dashboard and wallet trading are built and go live at the URL above once this branch merges to `main`; the submission package is written; what remains is calendar-bound (settlement, video, submit). The full product specification lives in [`prd-arsitektur.md`](prd-arsitektur.md) (Indonesian, v1.4 — Plan 3 as built).

## Live on Arbitrum Sepolia

Two identical pools are live, priced by two different implementations of the same math and fed by the **real Chainlink ETH/USD feed** (`0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165`, 8 dp, 120 s heartbeat). All addresses are in [`deployments/arbitrum-sepolia.json`](deployments/arbitrum-sepolia.json) (`pools`; deployed 19 Sep 2026 23:38 UTC at block 310687948 by `PoolE2EDeployer` `0xeb64b16e491f82497ea545a65b3db3d3e6c92df3`, boards listed 19 Sep 2026 23:54 UTC, first trades 20 Sep 2026):

| | Pool A — control | Pool B — Equinox |
|---|---|---|
| Pool (ERC-4626 vault over USDG) | `0x627b099c3e475f851d15ca9f261cd2f5b8b8be08` | `0x7f79616217cc49edea777108b60981d7bf807cc9` |
| Pricing math | `BlackScholesSol` `0x5b239ae1510aed1bb21eb9d2e8a471d45720c4b3` | Stylus program `0xb3b37050a40b9755001bddd29cc5df17a59f51d4` (cached) |
| Option token (ERC-1155) | `0xb275911e4d0af3640d48234d6f1cdce6f43aacc6` | `0x2ce0ead79441bf9e1bba8075aef031da98ed70d0` |
| Vol engine (**shared**; EWMA of Chainlink prints, Stylus `sqrt`/`ewmaUpdate`) | `0xc331031a1730a567fd9149d5950912a1cdcb6a3e` | same |
| USDG (`MockUSDG`, 6 dp, open `mint`) | `0xbd1cb2556b5a2ad232f913a5390d57a7f35942c1` | same |
| Sequencer uptime feed (`MockSequencerFeed`, always up) | `0x5154d98ac5c21aac01c0db923db484a7364139ff` | same |
| Boards (12 series per pool, identical inputs) | id 0: Fri 25 Sep 2026 08:00 UTC, strikes 2400 / 2600 / 2800; id 1: Fri 2 Oct 2026 08:00 UTC, strikes 2200 / 2600 / 3000 | same |
| Seed liquidity (owner deposit) | 1,000,000 USDG | 1,000,000 USDG |

**One vol engine for both pools** (decision K4 in the Plan 3 spec, `docs/superpowers/specs/2026-09-20-equinox-plan3-demo-design.md`): on a live feed two separate engines cannot stay identical, because `poke()` only observes the latest round and each trade only pokes its own pool's engine, so their EWMA histories drift apart. The engine was created for Pool B (Stylus math) and is shared by Pool A through `EquinoxFactory.createPoolWithVol`, so σ_base/σ_mark(0) are identical by construction (σ_mark(util) stays per pool, because util carries each pool's inventory). The honest consequence: Sepolia `buy`/`close` gas A vs B compares only the two pricing calls (`cappedCall` for calls, `quote` for puts) — `sqrt`/`ewmaUpdate` run in the same engine for both — and A's column now pays Stylus `sqrt` too while B's no longer pays the uncached init premium, so Sepolia ratios are not comparable with the devnode rows below; the devnode run (two engines, static mock feed) stays the apples-to-apples benchmark.

Mocked on purpose (no testnet equivalents): `MockUSDG` (6 dp, open `mint` = faucet) and `MockSequencerFeed` (Chainlink publishes no L2 sequencer uptime feed on Arbitrum Sepolia; its `set(int256,uint256)` is open — a testnet artefact, so anyone could flip it to "down" or re-arm the 3600 s grace and block quotes, deposits and `settle` until reset — which is why the keeper and `sepolia-demo.sh --claim` read it first and reset it to `set(0, now − 7200)` when needed). Everything else is real: the price feed, the cached Stylus program, the Friday 08:00 UTC settlement grid.

**Source verification.** All 12 Solidity contracts deployed on Sepolia are source-verified on [Sourcify](https://sourcify.dev) with an **exact match** (metadata hash included), 20 Sep 2026: `BlackScholesSol`, `Bench`, `PoolE2EDeployer`, `MockUSDG`, `MockSequencerFeed`, `EquinoxFactory`, `PoolDeployer`, `EquinoxVolEngine`, `EquinoxOptionToken` ×2, `EquinoxPool` ×2 — browse any of them at `https://repo.sourcify.dev/421614/<address>` (e.g. [Pool B](https://repo.sourcify.dev/421614/0x7f79616217cc49edea777108b60981d7bf807cc9)). `tools/sepolia/verify.sh` does it without an API key or a private key: it reads the inner addresses on-chain (`factory()`, `poolDeployer()`, `token()`, `vol()`), runs `forge verify-contract --chain 421614 --verifier sourcify` per contract from `contracts/`, tolerates a per-contract failure and prints `verified | partial | failed: <reason>` for each; re-running only resubmits what is not an exact match yet. Arbiscan verification is optional and needs your own `ETHERSCAN_API_KEY` (`--verifier etherscan` plus explicit `--constructor-args`, including the full `Deploy` tuple for the pools) — not done. The Stylus program is not source-verified (`cargo stylus verify` needs a reproducible Docker build) — its behaviour is checked instead by the 20 on-chain exactness checks.

**Keeper.** A GitHub Actions workflow (`.github/workflows/keeper.yml`: cron every 15 min plus `workflow_dispatch`; wallet `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B`, funded with 0.02 Sepolia ETH; the cron only fires once the workflow is on `main`) pokes the shared vol engine and settles expired boards on both pools. Settlement is permissionless, so the keeper only speeds things up — `tools/demo/sepolia-demo.sh --claim` settles by itself if the keeper has not.

**Demo log.** [`docs/DEMO_LOG.md`](docs/DEMO_LOG.md) records every demo transaction with Arbiscan links (run of 20 Sep 2026 on board 0): `quoteBuy` 10 C 2800 returned 268.181826 USDG (σ_buy 0.667412) on both pools at block 310700824, byte-identical — both books were still identical at that block; then `buy` 10 C 2800, `buy` 1 P 2400 and `close` 5 C 2800 on both. Like-for-like gas — same `poke` path on both sides, shared engine (caveat above): `buy` 1 P 2400 345,760 (A) vs 312,273 (B), `close` 5 C 2800 265,191 vs 212,988; the `buy` 10 C 2800 pair (422,695 vs 345,781) is not like-for-like because A's tx ran the full EWMA `poke` path and B's did not. Rows and caveats: [`docs/BENCHMARK.md`](docs/BENCHMARK.md), "Transaksi pool di Sepolia". One `buy` on Pool A **ran out of gas**: `cast send` used Nitro's zero-margin `eth_estimateGas` as the limit, the call's minimum gas rose ≈ 750 with `block.timestamp` before inclusion, and `cast send` reported the failed receipt as a success; `send()` in `tools/sepolia/lib.sh` now pads the limit to 1.5 × the estimate and fails hard on `status 0`, the trade was repeated, and the full post-mortem (per-block estimate replay) is in the demo log. Because that repeat was filled against a later Chainlink round, the two books now differ by ≈ 1.6 vega, so quotes on the two pools differ by ≈ 0.0006 USDG (≈ 2 × 10⁻⁵ relative; 25.140896 vs 25.141500 USDG for 1 C 2800 at block 310714347) through the inventory term of σ_mark while these positions are open. The live identity claim is therefore **math parity** (decision K5 in the Plan 3 spec): both `math` contracts return byte-identical prices for identical inputs (S, K, t, σ) — verified by `onchain-check` 20/20 and direct calls — and σ_base/σ_mark(0) come from the one shared engine; pool quotes are shown side by side with each pool's utilisation and legitimately differ once trade histories diverge. The demo script compares pool quotes byte-for-byte only while both pools carry identical inventory (`netVega` and the capital reference used for util/caps, `min(cash − escrow, capitalRefPrev)`, equal at that block); otherwise it checks math parity directly on both `math` contracts at the quote's own inputs, reproduces each pool's premium from its own `math`, and prints the pool-quote Δ — `tools/demo/sepolia-demo.sh --check` runs exactly that block read-only (no transaction, nothing written to the log). `--claim` runs after the first real settlement (Fri 25 Sep 2026 08:00 UTC) and appends the payouts to the log.

**Try it** (read-only, no key, no ETH — needs Foundry's `cast`):

```bash
# quote 1.0 × C 2800 (board 25 Sep) on Pool B — seriesIds.B[4] in deployments/arbitrum-sepolia.json
cast call 0x7f79616217cc49edea777108b60981d7bf807cc9 \
  "quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))" \
  45870539091541517489681866570457071163377503759886667160931538903975825194874 1000000000000000000 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
# → (premiumAssets, feeAssets [USDG, 6 dp], sigma, delta, vegaTotal, spotWad [WAD, 1e18]); reverts from 60 s before board 0's
#   expiry on 25 Sep 2026 08:00 UTC (`SeriesExpired`), then `SeriesSettled` after settlement — use a board-1 id (expiry 2 Oct) then.
# Same series with Solidity math: Pool A 0x627b099c3e475f851d15ca9f261cd2f5b8b8be08, seriesIds.A[4]
#   41551611760187069091162684964077452440970677971418960621668611916735289915441
```

To trade from a shell, put a funded key in a git-ignored `.env` (`SEPOLIA_PRIVATE_KEY`, optional `SEPOLIA_RPC_URL`) and run `tools/demo/sepolia-demo.sh --trade [board index]` — it compares pool quotes only while both pools carry identical inventory (`netVega` and the util/cap capital reference equal at that block); otherwise it checks math parity directly on both `math` contracts and prints the pool-quote Δ (K5); `--check` runs the same quote block without trading.

**Dashboard.** The page at <https://nodesproof.github.io/equinox/> (`web/`, Vite + TypeScript + viem, no backend — reads every address from `deployments/arbitrum-sepolia.json` and polls the public RPC directly) shows the series board for both pools with K5 math parity checked live, each pool's quote side by side with the inventory Δ that separates them once trade histories diverge, NAV, gas A vs B for `buy` (1 unit, ATM series — `eth_estimateGas`), and an activity feed with a σ_base chart built from pool and vol-engine events. Connect MetaMask on Arbitrum Sepolia to drive the same faucet → approve → buy/close/claim flow as `sepolia-demo.sh`, with every write simulated — and its revert decoded — before the wallet opens; without a wallet the page is read-only. `?rpc=http://127.0.0.1:8545` overrides the RPC with a loopback node (anything non-loopback is ignored) and `?poll=4000` shortens the refresh interval (floor 2000 ms, default 15000). Source and details: [`web/README.md`](web/README.md).

## Why

- Every live on-chain options venue we know of feeds implied volatility — the one Black-Scholes input that cannot be observed and that moves premiums by 17–33 % per 10 vol points — from a server or a team-run oracle. Whoever controls that number controls the transfer of value between LPs and traders.
- It is *not* that Black-Scholes cannot run on the EVM (Lyra did it in 2021). What gets cut in Solidity is the full quant loop: Greeks on every quote, an iterative implied-vol solve (3–20 evaluations), mark-to-market NAV across every open series on every deposit, realized-vol updates on every observation. Teams pruned it, or moved pricing off-chain.
- Equinox keeps the whole loop on-chain, in a Rust library that is unit-tested natively against an exact-integer specification, and measures honestly what Stylus buys (see the benchmark below: 2.6–2.9× on loop workloads, not 10×).

## How it works

```
 Chainlink ETH/USD ──► EquinoxVolEngine ── σ_base = EWMA realized vol
                        σ_mark = σ_base × VRP × (1 + α · inventory)
                                   │
 trader ── buy/close ──► EquinoxPool (EVM, USDG, ERC-1155 series) ──STATICCALL──► black_scholes (Stylus, Rust)
 LP ──── deposit/withdraw ──► NAV = cash − escrow − Σ mark-to-market        price · Greeks · impliedVol · ewmaUpdate · markPortfolio
                                   │
                        reserved = Σ OI × K  ≤  assets   (hard solvency; call payout = min(S_T − K, K))
```

- **Pricing:** Black-Scholes with five Greeks per quote; calls priced as the spread `C(K) − C(2K)` so the reserve is exactly `K` per unit (the cap costs buyers < 0.001 % of premium for 7–30 day tenors at normal ETH volatility).
- **Volatility without an oracle:** `σ_base` is an EWMA of log-returns between Chainlink rounds (irregular Δt handled); inventory impact raises σ when the pool is net short vega, and a symmetric spread makes round-trips non-free.
- **Numerics:** WAD (1e18) fixed point on `I256`; `exp`/`ln`/`sqrt` are bit-exact ports of PRBMath v4; Φ uses Cody's rational erfc approximation (≤ 1e-16 abs error); no floating point anywhere. Solver: safeguarded Newton (bracket + bisection), 3–20 iterations across the domain.
- **Pool (Plan 2, done):** `EquinoxPool` is an ERC-4626 vault over USDG that lists boards (Friday 08:00 UTC expiries, whole-USDG strikes in `[S/2, 2S]`), sells and buys back series priced at `σ_mark(util)` with a sign-aware spread, and settles permissionlessly against whatever fresh post-expiry Chainlink round exists when `settle` is called (an operator must run a keeper; the bounty is an incentive, not a guarantee). NAV is marked at `σ_mark(0)` (no inventory impact — a NAV marked at `σ_mark(util)` is sandwichable by deposit/redeem), blackout/expired series are marked at intrinsic, and trades never cross that mark (buy ≥ mark ≥ close), so no trade can lower NAV. Utilisation and vega caps use a capital reference lagged by one day (`min(live, 1-day-old snapshot)`): new deposits expand trading capacity after 1–2 days, withdrawals shrink it immediately.
- **Pool safety posture and requirements:** `nonReentrant` on `buy`/`close`/`settle`/`claim` and on the four ERC-4626 entry points (owner-only admin functions are not guarded), checks-effects-interactions, `Ownable2Step` owner (no timelock — recommended for production), hard bounds on every config and vol parameter (vol parameters also rate-limited), and fail-closed on a stale oracle or a dead math program (withdraw/redeem continue on a conservative NAV; deposit/mint revert). NAV is evaluated once per ERC-4626 call through a transient-storage memo (EIP-1153), so the pool needs Arbitrum ArbOS ≥ 20 (the devnode runs ArbOS 61) and solc ≥ 0.8.28 targeting cancun or later (the `forge build` artifacts — solc 0.8.28 default — and the Sepolia bytecode are compiled for `prague`). The factory is two-level (`EquinoxFactory` → `PoolDeployer` → `new EquinoxPool`) because of the 24,576-byte code limit; CI fails on a negative runtime margin (`forge build --sizes`).

## Repository layout

| Path | What |
|---|---|
| `tools/reference/` | `wad_emul.py` — exact-integer emulation, the executable specification; `gen_constants.py`, `gen_vectors.py` — generate the constants and the test vectors used by Rust and Solidity: 1,284 exact-integer vectors for Rust (`exp` 22, `ln` 20, `sqrt` 15, Φ 341, φ 161, `quote` 700, capped 6, IV 11, EWMA 5, portfolio 3) plus 700 float-reference rows for the same `quote` inputs, and a 182-vector Solidity subset (Φ 69, `quote` 100, capped 6, EWMA 5, portfolio 2); `bs_numbers.py`, `bs_extra.py` — float reference for the PRD tables |
| `stylus/bs-math/` | Pure `no_std` Rust crate (`I256`/`U256` only): `fixed`, `exp`, `ln`, `normal`, `bs`, `solver`, `ewma`, `portfolio`; 23 tests asserting exact equality with the vectors |
| `stylus/bs-stylus/` | Stateless Stylus program wrapping `bs-math` with a Solidity ABI (`view` only, typed errors) |
| `contracts/` | Foundry project: `src/interfaces/IBlackScholes.sol` (exported from Stylus), `src/math/BlackScholesSol.sol` (control implementation on PRBMath v4), `src/Bench.sol` (gas harness); 12 exact-equality tests |
| `contracts/src/pool/`, `contracts/src/oracle/` | `EquinoxPool` (ERC-4626 vault + options AMM), `EquinoxVolEngine`, `EquinoxOptionToken`, two-level `EquinoxFactory`, `OracleLib`; tests under `contracts/test/` incl. invariants (`EquinoxPool.invariants.t.sol`) and the `PoolFixture`; `src/mocks/` holds `MockUSDG`, `MockFeed`, `MockSequencerFeed`, `MockSwitchableMath` and the E2E deployer |
| `tools/devnode/` | `up.sh` — local Nitro devnode with automatic ArbOS 61 (Stylus v3) upgrade; `deploy.sh` — deploys the Stylus program, the control and the harness to any RPC |
| `tools/bench/` | `onchain-check.sh` — 20 bit-exact on-chain checks against the Python spec (both implementations); `bench.sh` — apples-to-apples gas table with return-bytes parity |
| `tools/e2e/` | `pool-e2e.sh` — deploys two identical pools on a live node (control vs Stylus), runs deposit → board → buy → close → deposit on both, asserts byte-identical quotes/NAV/σ/reserves/cash and prints the pool gas rows |
| `tools/sepolia/`, `tools/keeper/`, `tools/demo/` | Sepolia operations: `lib.sh` (`.env` + JSON, hardened `send()`), `deploy-pools.sh` (two pools, real feed, shared engine), `list-boards.sh` (seed LP + boards), `verify.sh` (Sourcify source verification, no keys); `keeper.sh` (poke + settle + sequencer-mock self-heal, run by `.github/workflows/keeper.yml`); `sepolia-demo.sh` (`--trade` / `--check` / `--claim`, writes `docs/DEMO_LOG.md`) |
| `deployments/` | `arbitrum-sepolia.json` — the single source of addresses (math, `pools`, boards, series ids); `devnode.json` is written by `tools/devnode/deploy.sh` |
| `web/` | The dashboard: Vite + TypeScript + viem, no framework, no backend; `src/chain/` (multicall snapshot, K5 parity, gas estimate, events, wallet writes), `src/panels/`, `test/` (unit + network + smoke), `scripts/` (ABI generation, build-time event seed); published by `.github/workflows/pages.yml` — details in [`web/README.md`](web/README.md) |
| `docs/` | `BENCHMARK.md` (measured results, devnode and Sepolia), `DEMO_LOG.md` (live Sepolia demo transactions), `OPS_SEPOLIA.md` (settlement runbook), `VERIFICATION.md` (day-1 environment checks), the submission package (`SUBMISSION.md`, `VIDEO_SCRIPT.md`, `JUDGE_QA.md`, `RUBRIC_SCORECARD.md`, `DEMO_RUNBOOK.md`), `superpowers/specs/` and `superpowers/plans/` (design specs and implementation plans) |
| `prd-arsitektur.md` | PRD & technical architecture v1.4 (Indonesian; Plan 3 as built) |

## One algorithm, three implementations, one truth

```
wad_emul.py (exact integers)  ──gen_vectors.py──►  vectors_gen.rs / VectorsGen.sol
        │                                                   │                │
        └── selftest vs float reference           cargo test (23)      forge test (12)
                                                            └────── onchain-check.sh (20) ──────┘
                                                        Stylus program  ==  Solidity control  ==  spec
```

CI regenerates the constants and vectors and fails on any drift, runs both test suites, builds the WASM, runs `cargo stylus check` against Sepolia, and enforces the EIP-170 size limit (`forge build --sizes` — every runtime margin must be non-negative; `PoolDeployer` embeds the pool's initcode and has ≈ 1.5 KB left).

## Benchmark (measured, not estimated)

Local Nitro devnode (`offchainlabs/nitro-node:v3.11.4`, ArbOS 61 / Stylus v3), gas measured with `gasleft()` around an identical `STATICCALL` to each implementation. Both return byte-identical results on every row. Full table and method: [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

| Operation | Solidity (control) | Stylus, uncached | Stylus, cached (derived) | Ratio |
|---|---:|---:|---:|---:|
| `normCdf` | 5,435 | 34,623 | 8,327 | 0.6× |
| `quote` (price + 4 Greeks) | 24,536 | 41,133 | 14,837 | 1.6× |
| `impliedVol`, 20 iterations (deep OTM) | 616,839 | 249,669 | 223,373 | 2.8× |
| `markPortfolio`, 32 series, one call | 1,242,892 | 453,744 | 427,448 | 2.9× |

Take-aways: Stylus wins on loop-heavy work (solver, batch mark-to-market) by 2.6–2.9× and loses on single calls unless the program is cached (fixed init cost ≈ 31k gas, 5k when cached). 256-bit fixed-point arithmetic itself is ~3× *more* expensive in WASM than the EVM's native `MUL`/`DIV`; the savings come from control flow, loops and ABI handling. Not 10×. The 1 MiB default Rust stack costs 17 memory pages per call — this repo pins the stack to 16 KiB.

At the transaction level the difference almost disappears: on two identical pools `buy` is 387,211 vs 367,932 gas (1.05×), `close` 254,792 vs 235,533 (1.08×) and a `deposit` with six open series 219,538 vs 220,352 (0.99× — a single `markPortfolio` over one live series no longer amortises the uncached init cost). Storage and token transfers dominate; math is ≈ 23–27 % of a `buy`. Rows, method and caveats in [`docs/BENCHMARK.md`](docs/BENCHMARK.md), which also holds the `buy`/`close` rows measured on the live Sepolia pools — those share one vol engine and a cached program, so they are not comparable with the devnode rows (see "Live on Arbitrum Sepolia" above).

## Getting started

Prerequisites: Rust 1.92 with the `wasm32-unknown-unknown` target, [`cargo-stylus`](https://github.com/OffchainLabs/cargo-stylus) 0.10.9, [Foundry](https://getfoundry.sh) ≥ 1.5, Python 3.12, `jq`, `bc`, and Docker for the local devnode.

```bash
# 1. Executable specification and its selftest
python3 tools/reference/wad_emul.py            # ends with: SELFTEST OK

# 2. Rust library (native tests, no node needed)
cd stylus/bs-math && cargo test && cd ../..    # 23 passed

# 3. Stylus program: WASM build + on-chain validity check (public Sepolia RPC)
cd stylus/bs-stylus && cargo stylus check --endpoint https://sepolia-rollup.arbitrum.io/rpc && cd ../..

# 4. Solidity control
cd contracts && forge test && cd ..            # 87 passed (9 suites: math control, oracle, token, vol engine, pool, invariants, factory, E2E deployer, narrative)

# 5. Local devnode: deploy both implementations, verify on-chain, benchmark
tools/devnode/up.sh                            # terminal 1 (blocking); prints "devnode siap: ..."
tools/devnode/deploy.sh devnode http://127.0.0.1:8547 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659
tools/bench/onchain-check.sh deployments/devnode.json   # 20 × OK
tools/bench/bench.sh deployments/devnode.json           # gas table
tools/e2e/pool-e2e.sh deployments/devnode.json 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659   # two identical pools, control vs Stylus
```

Regenerate constants and vectors after touching `wad_emul.py` (CI checks they are byte-identical to the generator output):

```bash
python3 tools/reference/gen_constants.py stylus/bs-math/src/constants.rs contracts/src/math/BsConstants.sol
python3 tools/reference/gen_vectors.py stylus/bs-math/tests/common/vectors_gen.rs contracts/test/VectorsGen.sol
```

The math is already deployed on Arbitrum Sepolia (`deployments/arbitrum-sepolia.json`: Stylus program `0xb3b37050a40b9755001bddd29cc5df17a59f51d4`, cached; `BlackScholesSol` `0x5B239AE1510AED1Bb21EB9d2e8A471D45720c4B3`; `Bench` `0x5801Aa89eAdABDE9ea21D2e26858760F8B71f346`). Verify it yourself with `tools/bench/onchain-check.sh deployments/arbitrum-sepolia.json` (read-only, 20 × OK) or `tools/bench/bench.sh deployments/arbitrum-sepolia.json` (the program is cached there, so read the measured column). To redeploy with your own funded key, put it in a git-ignored `.env` (`SEPOLIA_PRIVATE_KEY=0x…`, `SEPOLIA_RPC_URL=…`) and run `tools/devnode/deploy.sh arbitrum-sepolia "$SEPOLIA_RPC_URL" "$SEPOLIA_PRIVATE_KEY"`; if the Stylus step fails with "max fee per gas less than block base fee", re-run with `STYLUS_MAX_FEE_GWEI=1` (the script now aborts before deploying the Solidity contracts when the Stylus deploy fails); caching is a separate `cargo stylus cache bid <program> 0` from `stylus/bs-stylus`.

## On-chain interface

All functions are `view`; values are WAD (1e18) unless noted. Names are camelCase on the ABI.

| Function | Returns |
|---|---|
| `price(s, k, t, sigma, r, isCall)` | option price |
| `quote(s, k, t, sigma, r, isCall)` | `(price, delta, gamma, vega, theta)` — vega per 1.00 vol, theta per year |
| `cappedCall(s, k, cap, t, sigma, r)` | `(price, delta, vega)` for `C(k) − C(cap)` |
| `impliedVol(target, s, k, t, r, isCall, lo, hi)` | `(sigma, iterations)` |
| `ewmaUpdate(varPrev, pPrev, pNow, dtSeconds, lambdaPerDay)` | updated annualized variance |
| `markPortfolio(s, r, sigma, capMult, k[], t[], isCall[], oi[])` | `(Σ oi·mid, Σ oi·vega)` for up to 32 series in one call |
| `exp`, `ln`, `sqrt`, `normCdf`, `normPdf` | primitives |

Errors: `OutOfDomain(uint8 arg)`, `NoConvergence(uint8 iters)`, `LengthMismatch()`, `Overflow()`. Domain: `S, K ∈ [1e-6, 1e12]`, `T ∈ [60 s, 1 year]`, `σ ∈ [1 %, 500 %]`, `|r| ≤ 100 %`.

## Roadmap

- **Plan 2 — pool (done):** `EquinoxPool` (ERC-4626 over USDG, boards/series as ERC-1155, buy/close, settlement, claims, mark-to-market NAV), `EquinoxVolEngine`, two-level factory, invariants (solvency fuzzed), two identical pools verified on a devnode.
- **Plan 3a — Sepolia (done):** both pools live with the real Chainlink feed and a shared vol engine, two boards, seed LP, keeper cron, live demo log, deterministic narrative test.
- **Plan 3b — web & submission (built 20 Sep 2026):** dashboard + wallet trading (GitHub Pages, live after merge), source verification on Sourcify, submission package, PRD v1.4. Still on the calendar: first real settlement and `--claim` on Fri 25 Sep 2026 08:00 UTC, the video, the submission itself. Not built (P1): withdrawal cooldown, strike skew, `minListingDelta`, `EquinoxLens`, the Python calibrator (λ/VRP are seeds, not calibrated).
- **After the hackathon:** `i128` Q64.64 internals (measured ~3.6× cheaper per multiply than `I256`), program caching on Arbitrum One, delta hedging via perps, BTC/USDG, options on tokenized equities.

## License

MIT — see [`LICENSE`](LICENSE).
