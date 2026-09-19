# Equinox

**An options AMM for ETH on Arbitrum whose prices are computed entirely on-chain.**

Liquidity providers deposit [USDG](https://paxos.com/usdg/) and become the option writer; traders buy short-dated (7–30 day) European ETH calls and puts, cash-settled in USDG. The pool prices every trade itself with Black-Scholes executed on-chain in Rust via [Arbitrum Stylus](https://docs.arbitrum.io/stylus/gentle-introduction), using an implied volatility it **derives on-chain** — realized volatility from Chainlink observations plus inventory pressure. The only external input is the ETH spot price. Puts are fully reserved and calls have a capped payout, so the pool can never owe more than it holds.

Built for the Arbitrum Open House Singapore Online Buildathon (2026).

## Status

| Piece | State |
|---|---|
| Quant core: Black-Scholes + Greeks, capped call, implied-vol solver, EWMA volatility, batch mark-to-market — in Python (executable spec), Rust/Stylus (production) and Solidity (control), all **bit-identical** | ✅ done, tested, deployed to a local Nitro devnode, benchmarked |
| Stylus program `bs-stylus` (`cargo stylus check` passes on Arbitrum Sepolia) | ✅ done |
| Pool contracts: LP vault (ERC-4626), option series (ERC-1155), buy/close, settlement, claims, volatility engine, two-level factory | ✅ done — 80 Foundry tests in 6 suites (68 on the pool, vol engine, option token and oracle, incl. 7 invariants: 32 runs × depth 128 in CI, 256 × 200 = 51,200 calls each in the long run), 93.4 % line coverage on `src/pool` + `src/oracle` (428/458 lines), three audit rounds plus a final fix wave; two identical pools (control vs Stylus) verified byte-identical on a devnode |
| Demo, UI, Sepolia deployment | ⏳ Plan 3 |

The pricing engine and the pool are implemented and verified; a demo, UI and testnet deployment are next (Plan 3). The full product specification lives in [`prd-arsitektur.md`](prd-arsitektur.md) (Indonesian).

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
- **Pool safety posture and requirements:** `nonReentrant` on `buy`/`close`/`settle`/`claim` and on the four ERC-4626 entry points (owner-only admin functions are not guarded), checks-effects-interactions, `Ownable2Step` owner (no timelock — recommended for production), hard bounds on every config and vol parameter (vol parameters also rate-limited), and fail-closed on a stale oracle or a dead math program (withdraw/redeem continue on a conservative NAV; deposit/mint revert). NAV is evaluated once per ERC-4626 call through a transient-storage memo (EIP-1153), so the pool needs Arbitrum ArbOS ≥ 20 (the devnode runs ArbOS 61) and solc ≥ 0.8.28 with the cancun EVM. The factory is two-level (`EquinoxFactory` → `PoolDeployer` → `new EquinoxPool`) because of the 24,576-byte code limit; CI fails on a negative runtime margin (`forge build --sizes`).

## Repository layout

| Path | What |
|---|---|
| `tools/reference/` | `wad_emul.py` — exact-integer emulation, the executable specification; `gen_constants.py`, `gen_vectors.py` — generate the constants and ~2,000 test vectors used by Rust and Solidity; `bs_numbers.py`, `bs_extra.py` — float reference for the PRD tables |
| `stylus/bs-math/` | Pure `no_std` Rust crate (`I256`/`U256` only): `fixed`, `exp`, `ln`, `normal`, `bs`, `solver`, `ewma`, `portfolio`; 23 tests asserting exact equality with the vectors |
| `stylus/bs-stylus/` | Stateless Stylus program wrapping `bs-math` with a Solidity ABI (`view` only, typed errors) |
| `contracts/` | Foundry project: `src/interfaces/IBlackScholes.sol` (exported from Stylus), `src/math/BlackScholesSol.sol` (control implementation on PRBMath v4), `src/Bench.sol` (gas harness); 12 exact-equality tests |
| `contracts/src/pool/`, `contracts/src/oracle/` | `EquinoxPool` (ERC-4626 vault + options AMM), `EquinoxVolEngine`, `EquinoxOptionToken`, two-level `EquinoxFactory`, `OracleLib`; tests under `contracts/test/` incl. invariants (`EquinoxPool.invariants.t.sol`) and the `PoolFixture`; `src/mocks/` holds `MockUSDG`, `MockFeed`, `MockSequencerFeed`, `MockSwitchableMath` and the E2E deployer |
| `tools/devnode/` | `up.sh` — local Nitro devnode with automatic ArbOS 61 (Stylus v3) upgrade; `deploy.sh` — deploys the Stylus program, the control and the harness to any RPC |
| `tools/bench/` | `onchain-check.sh` — 20 bit-exact on-chain checks against the Python spec (both implementations); `bench.sh` — apples-to-apples gas table with return-bytes parity |
| `tools/e2e/` | `pool-e2e.sh` — deploys two identical pools on a live node (control vs Stylus), runs deposit → board → buy → close → deposit on both, asserts byte-identical quotes/NAV/σ/reserves/cash and prints the pool gas rows |
| `docs/` | `BENCHMARK.md` (measured results), `VERIFICATION.md` (day-1 environment checks), `superpowers/plans/` (implementation plans) |
| `prd-arsitektur.md` | PRD & technical architecture v1.3 (Indonesian) |

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

At the transaction level the difference almost disappears: on two identical pools `buy` is 387,211 vs 367,932 gas (1.05×), `close` 254,792 vs 235,533 (1.08×) and a `deposit` with six open series 219,538 vs 220,352 (0.99× — a single `markPortfolio` over one live series no longer amortises the uncached init cost). Storage and token transfers dominate; math is ≈ 23–27 % of a `buy`. Rows, method and caveats in [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

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
cd contracts && forge test && cd ..            # 80 passed (6 suites: math control, oracle, token, vol engine, pool, invariants)

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

Deploy to Arbitrum Sepolia with a funded key: `tools/devnode/deploy.sh arbitrum-sepolia https://sepolia-rollup.arbitrum.io/rpc <private-key>`, then run `onchain-check.sh` on the produced `deployments/arbitrum-sepolia.json`.

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
- **Plan 3 — demo & submission:** Sepolia deployment of both pools, demo script/UI, video. Not built (P1): withdrawal cooldown, strike skew, `minListingDelta`, `EquinoxLens`.
- **After the hackathon:** `i128` Q64.64 internals (measured ~3.6× cheaper per multiply than `I256`), program caching on Arbitrum One, delta hedging via perps, BTC/USDG, options on tokenized equities.

## License

MIT — see [`LICENSE`](LICENSE).
