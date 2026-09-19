# Equinox

**An options AMM for ETH on Arbitrum whose prices are computed entirely on-chain.**

Liquidity providers deposit [USDG](https://paxos.com/usdg/) and become the option writer; traders buy short-dated (7–30 day) European ETH calls and puts, cash-settled in USDG. The pool prices every trade itself with Black-Scholes executed on-chain in Rust via [Arbitrum Stylus](https://docs.arbitrum.io/stylus/gentle-introduction), using an implied volatility it **derives on-chain** — realized volatility from Chainlink observations plus inventory pressure. The only external input is the ETH spot price. Puts are fully reserved and calls have a capped payout, so the pool can never owe more than it holds.

Built for the Arbitrum Open House Singapore Online Buildathon (2026).

## Status

| Piece | State |
|---|---|
| Quant core: Black-Scholes + Greeks, capped call, implied-vol solver, EWMA volatility, batch mark-to-market — in Python (executable spec), Rust/Stylus (production) and Solidity (control), all **bit-identical** | ✅ done, tested, deployed to a local Nitro devnode, benchmarked |
| Stylus program `bs-stylus` (`cargo stylus check` passes on Arbitrum Sepolia) | ✅ done |
| Pool contracts: LP vault (ERC-4626), option series (ERC-1155), buy/close, settlement, claims, volatility engine | ⏳ next (Plan 2) |
| Demo, UI, Sepolia deployment | ⏳ Plan 3 |

So today this repository is the **pricing engine and its verification tooling**, not yet a tradable venue. The full product specification lives in [`prd-arsitektur.md`](prd-arsitektur.md) (Indonesian).

## Why

- Every live on-chain options venue we know of feeds implied volatility — the one Black-Scholes input that cannot be observed and that moves premiums by 17–33 % per 10 vol points — from a server or a team-run oracle. Whoever controls that number controls the transfer of value between LPs and traders.
- It is *not* that Black-Scholes cannot run on the EVM (Lyra did it in 2021). What gets cut in Solidity is the full quant loop: Greeks on every quote, an iterative implied-vol solve (3–20 evaluations), mark-to-market NAV across every open series on every deposit, realized-vol updates on every observation. Teams pruned it, or moved pricing off-chain.
- Equinox keeps the whole loop on-chain, in a Rust library that is unit-tested natively against an exact-integer specification, and measures honestly what Stylus buys (see the benchmark below: 2.6–2.9× on loop workloads, not 10×).

## How it works

```
 Chainlink ETH/USD ──► EquinoxVolEngine ── σ_base = EWMA realized vol      (Plan 2)
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

## Repository layout

| Path | What |
|---|---|
| `tools/reference/` | `wad_emul.py` — exact-integer emulation, the executable specification; `gen_constants.py`, `gen_vectors.py` — generate the constants and ~2,000 test vectors used by Rust and Solidity; `bs_numbers.py`, `bs_extra.py` — float reference for the PRD tables |
| `stylus/bs-math/` | Pure `no_std` Rust crate (`I256`/`U256` only): `fixed`, `exp`, `ln`, `normal`, `bs`, `solver`, `ewma`, `portfolio`; 23 tests asserting exact equality with the vectors |
| `stylus/bs-stylus/` | Stateless Stylus program wrapping `bs-math` with a Solidity ABI (`view` only, typed errors) |
| `contracts/` | Foundry project: `src/interfaces/IBlackScholes.sol` (exported from Stylus), `src/math/BlackScholesSol.sol` (control implementation on PRBMath v4), `src/Bench.sol` (gas harness); 12 exact-equality tests |
| `tools/devnode/` | `up.sh` — local Nitro devnode with automatic ArbOS 61 (Stylus v3) upgrade; `deploy.sh` — deploys the Stylus program, the control and the harness to any RPC |
| `tools/bench/` | `onchain-check.sh` — 20 bit-exact on-chain checks against the Python spec (both implementations); `bench.sh` — apples-to-apples gas table with return-bytes parity |
| `docs/` | `BENCHMARK.md` (measured results), `VERIFICATION.md` (day-1 environment checks), `superpowers/plans/` (implementation plans) |
| `prd-arsitektur.md` | PRD & technical architecture v1.2 (Indonesian) |

## One algorithm, three implementations, one truth

```
wad_emul.py (exact integers)  ──gen_vectors.py──►  vectors_gen.rs / VectorsGen.sol
        │                                                   │                │
        └── selftest vs float reference           cargo test (23)      forge test (12)
                                                            └────── onchain-check.sh (20) ──────┘
                                                        Stylus program  ==  Solidity control  ==  spec
```

CI regenerates the constants and vectors and fails on any drift, runs both test suites, builds the WASM and runs `cargo stylus check` against Sepolia.

## Benchmark (measured, not estimated)

Local Nitro devnode (`offchainlabs/nitro-node:v3.11.4`, ArbOS 61 / Stylus v3), gas measured with `gasleft()` around an identical `STATICCALL` to each implementation. Both return byte-identical results on every row. Full table and method: [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

| Operation | Solidity (control) | Stylus, uncached | Stylus, cached (derived) | Ratio |
|---|---:|---:|---:|---:|
| `normCdf` | 5,435 | 34,623 | 8,327 | 0.6× |
| `quote` (price + 4 Greeks) | 24,536 | 41,133 | 14,837 | 1.6× |
| `impliedVol`, 20 iterations (deep OTM) | 616,839 | 249,669 | 223,373 | 2.8× |
| `markPortfolio`, 32 series, one call | 1,242,892 | 453,744 | 427,448 | 2.9× |

Take-aways: Stylus wins on loop-heavy work (solver, batch mark-to-market) by 2.6–2.9× and loses on single calls unless the program is cached (fixed init cost ≈ 31k gas, 5k when cached). 256-bit fixed-point arithmetic itself is ~3× *more* expensive in WASM than the EVM's native `MUL`/`DIV`; the savings come from control flow, loops and ABI handling. Not 10×. The 1 MiB default Rust stack costs 17 memory pages per call — this repo pins the stack to 16 KiB.

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
cd contracts && forge test && cd ..            # 12 passed

# 5. Local devnode: deploy both implementations, verify on-chain, benchmark
tools/devnode/up.sh                            # terminal 1 (blocking); prints "devnode siap: ..."
tools/devnode/deploy.sh devnode http://127.0.0.1:8547 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659
tools/bench/onchain-check.sh deployments/devnode.json   # 20 × OK
tools/bench/bench.sh deployments/devnode.json           # gas table
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

- **Plan 2 — pool:** `EquinoxPool` (ERC-4626 over USDG, boards/series as ERC-1155, buy/close, settlement, claims, mark-to-market NAV), `EquinoxVolEngine`, factory, invariants (solvency fuzzed).
- **Plan 3 — demo & submission:** two identical pools (Solidity control vs Stylus) side by side, Sepolia deployment, video.
- **After the hackathon:** `i128` Q64.64 internals (measured ~3.6× cheaper per multiply than `I256`), program caching on Arbitrum One, delta hedging via perps, BTC/USDG, options on tokenized equities.

## License

MIT — see [`LICENSE`](LICENSE).
